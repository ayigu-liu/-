package handler

import (
	"log/slog"
	"net/http"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"

	"jjs-server/internal/config"
	"jjs-server/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WsHandler struct {
	Hub *ws.Hub
}

func NewWsHandler(hub *ws.Hub) *WsHandler {
	return &WsHandler{Hub: hub}
}

func (h *WsHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	if tokenStr == "" {
		http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
		return
	}

	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(config.AppConfig.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		http.Error(w, `{"error":"invalid token claims"}`, http.StatusUnauthorized)
		return
	}

	playerID, ok := claims["sub"].(string)
	if !ok || playerID == "" {
		http.Error(w, `{"error":"invalid token subject"}`, http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Error("ws upgrade failed", "error", err)
		return
	}

	client := &ws.Client{
		Hub:      h.Hub,
		Conn:     conn,
		PlayerID: playerID,
		Send:     make(chan []byte, 64),
	}

	h.Hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}
