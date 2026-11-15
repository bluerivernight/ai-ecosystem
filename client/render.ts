// Canvas 2D renderer. Cached map layer drawn once; sprites + bubbles per frame.
// 16×16 pixel sprites scaled 2× to TILE=32.

import { MAP, TILE, MAP_W, MAP_H, tileAt } from '../shared/map.js'
import { PERSON, type PersonColors } from '../shared/sprites.js'
import type { AgentSnapshot } from '../shared/types.js'

export interface UserInfo {
  x: number
  y: number
  walkPhase: number
}

const PALETTE: PersonColors = {
  shirt: '#6b7280',
  hair: '#111827',
  pants: '#33383f',
  shoes: '#22252a',
  skin: '#f0c9a0'
}

const DESK_COLORS: Record<string, string> = {
  '#': '#2c3140',
  '.': '#242831',
  D: '#8a5a33',
  P: '#3e7d46',
  B: '#6b4a2f',
  C: '#7a4a3a'
}

const DESK_TOP: Record<string, string> = {
  D: '#a8763f',
  P: '#4f9e57',
  B: '#8a6a45',
  C: '#8f5a4a'
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private mapLayer: HTMLCanvasElement
  private scale = 2

  constructor(
    private canvas: HTMLCanvasElement,
    private getUser: () => UserInfo
  ) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    this.ctx = ctx
    this.mapLayer = this.buildMapLayer()
  }

  private buildMapLayer(): HTMLCanvasElement {
    const s = this.scale
    const c = document.createElement('canvas')
    c.width = MAP_W * TILE
    c.height = MAP_H * TILE
    const g = c.getContext('2d')!
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = tileAt(x, y)
        g.fillStyle = DESK_COLORS[t] ?? '.'
        g.fillRect(x * TILE, y * TILE, TILE, TILE)
        if (t !== '#' && t !== '.') {
          // furniture: inset block with a lighter top face
          g.fillStyle = DESK_TOP[t] ?? DESK_COLORS[t]
          g.fillRect(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 14)
          g.fillStyle = 'rgba(0,0,0,0.25)'
          g.fillRect(x * TILE + 4, y * TILE + TILE - 10, TILE - 8, 6)
        }
        // subtle floor grid
        if (t === '.') {
          g.fillStyle = 'rgba(255,255,255,0.02)'
          g.fillRect(x * TILE, y * TILE, TILE, 1)
        }
      }
    }
    // walls get a top edge highlight
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (tileAt(x, y) === '#') {
          g.fillStyle = '#3a4052'
          g.fillRect(x * TILE, y * TILE, TILE, 4)
        }
      }
    }
    void s
    return c
  }

  draw(agents: AgentSnapshot[], nearAgentId: number | null, serverNow: number, camX: number, camY: number): void {
    const ctx = this.ctx
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.save()
    ctx.translate(-camX, -camY)
    ctx.drawImage(this.mapLayer, 0, 0)

    // user (client-authoritative)
    const u = this.getUser()
    this.drawPerson(u.x, u.y, 'down', PALETTE, Math.floor(u.walkPhase) % 2, 1.15)
    ctx.fillStyle = '#93c5fd'
    this.nameTag(u.x, u.y, 'YOU')

    // agents (server-authoritative snapshots)
    for (const a of agents) {
      const frame = a.status === 'walking' ? 1 : 0
      this.drawPerson(a.x, a.y, a.facing, agentPalette(a), frame, 1)
      this.nameTag(a.x, a.y, a.name, a.color)
      if (a.id === nearAgentId) this.highlight(a.x, a.y)
      if (a.bubble && serverNow > 0) this.bubble(a.x, a.y, a.bubble)
    }
    ctx.restore()

    if (!navigator.onLine) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, this.canvas.width, 24)
      ctx.fillStyle = '#fbbf24'
      ctx.font = '12px sans-serif'
      ctx.fillText('offline', 8, 16)
    }
  }

  private drawPerson(
    x: number,
    y: number,
    facing: 'down' | 'up' | 'left' | 'right',
    pal: PersonColors,
    frame: number,
    scaleBoost: number
  ): void {
    const ctx = this.ctx
    const sprite = PERSON.frames[Math.min(frame, PERSON.frames.length - 1)]!
    const s = 2 * scaleBoost
    const px = x * TILE - 8 * s + TILE / 2 - TILE / 2
    const py = y * TILE - 8 * s + 4
    for (let r = 0; r < sprite.length; r++) {
      for (let c = 0; c < sprite[r]!.length; c++) {
        const ch = sprite[r]![c]!
        if (ch === '.') continue
        let color = ''
        switch (ch) {
          case 'H': color = pal.hair; break
          case 's': color = pal.skin; break
          case 'T': color = pal.shirt; break
          case 'p': color = pal.pants; break
          case 'o': color = pal.shoes; break
          case 'e': color = facing === 'up' ? pal.hair : '#111'; break
          default: color = '#f00'
        }
        ctx.fillStyle = color
        ctx.fillRect(px + c * s, py + r * s, s, s)
      }
    }
  }

  private nameTag(x: number, y: number, name: string, color?: string): void {
    const ctx = this.ctx
    const px = x * TILE + TILE / 2
    const py = y * TILE - 6
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    const w = ctx.measureText(name).width + 8
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(px - w / 2, py - 10, w, 13)
    ctx.fillStyle = color ?? '#e5e7eb'
    ctx.fillText(name, px, py)
    ctx.textAlign = 'left'
  }

  private highlight(x: number, y: number): void {
    const ctx = this.ctx
    ctx.strokeStyle = '#fbbf24'
    ctx.lineWidth = 2
    ctx.strokeRect(x * TILE - 2, y * TILE - 2, TILE + 4, TILE + 4)
  }

  private bubble(x: number, y: number, text: string): void {
    const ctx = this.ctx
    const px = x * TILE + TILE / 2
    const py = y * TILE - 24
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    const w = ctx.measureText(text).width + 10
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.beginPath()
    ctx.roundRect(px - w / 2, py - 12, w, 16, 8)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(px - 4, py + 4)
    ctx.lineTo(px + 4, py + 4)
    ctx.lineTo(px, py + 9)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#111'
    ctx.fillText(text, px, py)
    ctx.textAlign = 'left'
  }
}

function agentPalette(a: AgentSnapshot): PersonColors {
  return {
    shirt: a.shirt,
    hair: a.hair,
    pants: '#33383f',
    shoes: '#22252a',
    skin: '#e8b98a'
  }
}

void MAP
