package ws

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096
)

type Client struct {
	Hub      *Hub
	Conn     *websocket.Conn
	PlayerID string
	Send     chan []byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[string]map[*Client]bool
	BroadcastC chan []byte
	Register   chan *Client
	Unregister chan *Client
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]bool),
		BroadcastC: make(chan []byte, 256),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			if h.clients[client.PlayerID] == nil {
				h.clients[client.PlayerID] = make(map[*Client]bool)
			}
			h.clients[client.PlayerID][client] = true
			h.mu.Unlock()
			slog.Debug("ws client connected", "playerID", client.PlayerID)

		case client := <-h.Unregister:
			h.mu.Lock()
			if clients, ok := h.clients[client.PlayerID]; ok {
				if _, ok := clients[client]; ok {
					delete(clients, client)
					close(client.Send)
				}
				if len(clients) == 0 {
					delete(h.clients, client.PlayerID)
				}
			}
			h.mu.Unlock()
			slog.Debug("ws client disconnected", "playerID", client.PlayerID)

		case msg := <-h.BroadcastC:
			h.mu.RLock()
			for _, clients := range h.clients {
				for client := range clients {
					select {
					case client.Send <- msg:
					default:
						go func(c *Client) { h.Unregister <- c }(client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Broadcast(msg []byte) {
	h.BroadcastC <- msg
}

func (h *Hub) SendToPlayer(playerID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	clients, ok := h.clients[playerID]
	if !ok {
		return
	}
	for client := range clients {
		select {
		case client.Send <- msg:
		default:
			go func(c *Client) { h.Unregister <- c }(client)
		}
	}
}

func (h *Hub) ConnectedCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg struct {
			Type string          `json:"type"`
			Data json.RawMessage `json:"data"`
		}
		if json.Unmarshal(message, &msg) == nil {
			if msg.Type == "join" {
				slog.Debug("ws join", "playerID", c.PlayerID)
			}
		}
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := c.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte("\n"))
				w.Write(<-c.Send)
			}
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
