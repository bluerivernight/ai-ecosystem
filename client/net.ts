// Client network: connect to /ws, keep latest world + events.

import type { AgentSnapshot, WorldMessage, EventMessage } from '../shared/types.js'

export class ClientNet {
  agents: AgentSnapshot[] = []
  taskCounts = { queued: 0, active: 0, done: 0 }
  connected = false
  onEvent: (text: string, ts: number) => void = () => {}
  onStateChange: () => void = () => {}

  private ws: WebSocket | null = null
  private retryMs = 2000

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.retryMs = 2000
      this.onStateChange()
    }
    ws.onclose = () => {
      this.connected = false
      this.onStateChange()
      setTimeout(() => this.connect(), this.retryMs)
      this.retryMs = Math.min(this.retryMs * 1.5, 15000)
    }
    ws.onmessage = raw => {
      try {
        const msg = JSON.parse(String(raw.data)) as WorldMessage | EventMessage
        if (msg.type === 'world') {
          this.agents = msg.agents
          this.taskCounts = msg.taskCounts
        } else if (msg.type === 'event') {
          this.onEvent(msg.text, msg.ts)
        }
      } catch {
        // ignore malformed frames
      }
    }
  }

  close(): void {
    this.ws?.close()
  }
}
