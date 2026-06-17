import { useAuthStore } from '@/stores/authStore'
import { useGameStore } from '@/stores/gameStore'
import type { WsMessage } from '@/types'

type MessageHandler = (msg: WsMessage) => void

class WsClient {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private handlers: Map<string, Set<MessageHandler>> = new Map()
  private reconnectAttempts = 0
  private maxReconnectDelay = 30000

  connect() {
    const { playerId, isAuthenticated } = useAuthStore.getState()
    if (!isAuthenticated || !playerId) return

    this.disconnect()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws?player_id=${playerId}`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      useGameStore.getState().setWsConnected(true)

      const { nickname } = useAuthStore.getState()
      this.send({ type: 'join', data: { nickname: nickname ?? playerId } })
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data)
        this.dispatch(msg)
      } catch {
        console.error('Failed to parse WS message')
      }
    }

    this.ws.onclose = () => {
      useGameStore.getState().setWsConnected(false)
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      useGameStore.getState().setWsConnected(false)
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler)
    return () => {
      this.handlers.get(type)?.delete(handler)
    }
  }

  private dispatch(msg: WsMessage) {
    const typeHandlers = this.handlers.get(msg.type)
    if (typeHandlers) {
      typeHandlers.forEach((h) => h(msg))
    }
    const allHandlers = this.handlers.get('*')
    if (allHandlers) {
      allHandlers.forEach((h) => h(msg))
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, this.maxReconnectDelay)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}

export const ws = new WsClient()
