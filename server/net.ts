// WebSocket broadcast hub. Clients get the world snapshot 4x per second
// and event lines as they happen. The world sim never touches sockets directly.

import type { WebSocketServer, WebSocket } from 'ws'
import type { WorldMessage, EventMessage, BossMessage } from '../shared/types.js'

export class Net {
  private clients = new Set<WebSocket>()
  private wss: WebSocketServer | null = null

  attach(wss: WebSocketServer): void {
    this.wss = wss
    wss.on('connection', ws => {
      this.clients.add(ws)
      ws.on('close', () => this.clients.delete(ws))
      ws.on('error', () => this.clients.delete(ws))
      ws.on('message', raw => {
        // ignore client messages for now (hello handshake is implicit)
        void raw
      })
    })
  }

  broadcastWorld(msg: WorldMessage): void {
    this.send(msg)
  }

  broadcastEvent(msg: EventMessage): void {
    this.send(msg)
  }

  broadcastBoss(msg: BossMessage): void {
    this.send(msg)
  }

  clientCount(): number {
    return this.clients.size
  }

  close(): void {
    for (const c of this.clients) c.close()
    this.clients.clear()
    this.wss?.close()
  }

  private send(msg: WorldMessage | EventMessage | BossMessage): void {
    const data = JSON.stringify(msg)
    for (const c of this.clients) {
      if (c.readyState === 1) c.send(data)
    }
  }
}
