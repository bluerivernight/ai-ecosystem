// Server-side world simulation: agent movement, work, chats, idle thoughts.
// Ticks at 4 Hz. All LLM work is async and serialized by the Llm queue, so the
// sim loop never blocks and idle CPU stays near zero.

import { findPath } from './pathfind.js'
import type { Db, AgentRow } from './db.js'
import type { Llm } from './llm.js'
import type { SkillRegistry } from './skills.js'
import type { ToolDef } from './tools.js'
import type { AppConfig } from './config.js'
import type { AgentSnapshot } from '../shared/types.js'
import { deskTiles, seatsForTile } from '../shared/map.js'
import { BOSS_ID } from '../shared/types.js'
import { runTask, oneLiner } from './agent.js'

type Status = 'idle' | 'walking' | 'working' | 'thinking' | 'chatting'

interface SimAgent {
  row: AgentRow
  x: number
  y: number
  facing: 'down' | 'up' | 'left' | 'right'
  path: Array<[number, number]>
  status: Status
  bubble: string | null
  bubbleUntil: number
  taskId: number | null
  workRunning: boolean
  lastChat: number
  walkPhase: number
}

const SPEED = 2.2 // tiles per second
const BUBBLE_MS = 6000

export class WorldSim {
  private agents = new Map<number, SimAgent>()
  private lastChat = 0
  private lastThink = 0

  constructor(
    private db: Db,
    private cfg: AppConfig,
    private llm: Llm,
    private skills: SkillRegistry,
    private tools: ToolDef[],
    private onEvent: (text: string) => void
  ) {
    this.hydrate()
  }

  /** Create agents from DB rows; assign each an open desk seat. */
  private hydrate(): void {
    const desks = deskTiles()
    const seats: Array<[number, number]> = []
    for (const d of desks) seats.push(...seatsForTile(d[0], d[1]))

    this.db.getAgents().forEach((row, i) => {
      const seat = seats[i % seats.length] ?? [2 + i, 1]
      this.agents.set(row.id, {
        row,
        x: seat[0] + 0.5,
        y: seat[1] + 0.5,
        facing: 'down',
        path: [],
        status: 'idle',
        bubble: null,
        bubbleUntil: 0,
        taskId: null,
        workRunning: false,
        lastChat: 0,
        walkPhase: 0
      })
    })
  }

  list(): SimAgent[] {
    return [...this.agents.values()]
  }

  snapshot(): AgentSnapshot[] {
    return this.list().map(a => ({
      id: a.row.id,
      name: a.row.name,
      color: a.row.color,
      shirt: a.row.shirt,
      hair: a.row.hair,
      x: a.x,
      y: a.y,
      facing: a.facing,
      status: a.status,
      bubble: a.bubble
    }))
  }

  bubble(agentId: number, text: string, ms = BUBBLE_MS): void {
    const a = this.agents.get(agentId)
    if (!a) return
    a.bubble = text.slice(0, 40)
    a.bubbleUntil = Date.now() + ms
  }

  /** Queue a task: agent walks to its desk, then works. The Boss never runs tasks. */
  assign(taskId: number, agentId: number): void {
    if (agentId === BOSS_ID) return
    const a = this.agents.get(agentId)
    if (!a) return
    const path = findPath(
      Math.floor(a.x),
      Math.floor(a.y),
      Math.floor(a.x), // stay where you are; the "desk" is where the agent already sits
      Math.floor(a.y)
    )
    void path // desks are the seat itself — path is empty; agent works in place
    a.taskId = taskId
    a.status = 'idle'
    this.bubble(agentId, 'got it!', 2500)
  }

  /** The Boss speaks in a speech bubble (god-view office). */
  bossSay(text: string): void {
    this.bubble(BOSS_ID, text, 15_000)
  }

  /** Send an agent to stand near another agent (visual, cheap). */
  walkTo(agentId: number, tx: number, ty: number): void {
    const a = this.agents.get(agentId)
    if (!a || a.status !== 'idle') return
    const path = findPath(Math.floor(a.x), Math.floor(a.y), tx, ty)
    if (path.length > 0) {
      a.path = path
      a.status = 'walking'
    }
  }

  tick(dt: number): void {
    const now = Date.now()
    for (const a of this.agents.values()) {
      if (a.bubble && now > a.bubbleUntil) a.bubble = null

      // movement
      if (a.path.length > 0) {
        const [tx, ty] = a.path[0]!
        const dx = tx + 0.5 - a.x
        const dy = ty + 0.5 - a.y
        const dist = Math.hypot(dx, dy)
        const step = SPEED * dt
        if (Math.abs(dx) > Math.abs(dy)) a.facing = dx > 0 ? 'right' : 'left'
        else if (dy !== 0) a.facing = dy > 0 ? 'down' : 'up'
        if (dist <= step) {
          a.x = tx + 0.5
          a.y = ty + 0.5
          a.path.shift()
          if (a.path.length === 0 && a.status === 'walking') a.status = 'idle'
        } else {
          a.x += (dx / dist) * step
          a.y += (dy / dist) * step
          a.walkPhase += dt * 8
        }
      }

      // arrived idle + pending task → work
      if (a.status === 'idle' && a.taskId !== null && !a.workRunning) {
        void this.startWork(a)
      }
    }

    this.maybeChat(now)
    this.maybeThink(now)
  }

  private async startWork(a: SimAgent): Promise<void> {
    const taskId = a.taskId
    a.taskId = null
    a.workRunning = true
    a.status = 'working'
    const task = this.db.getTask(taskId!)
    if (!task) {
      a.workRunning = false
      a.status = 'idle'
      return
    }
    this.bubble(a.row.id, `working: ${task.title}`, 120_000)
    this.onEvent(`${a.row.name} started working on "${task.title}"`)
    this.db.setTask(taskId!, 'active', null)

    const ctx = {
      db: this.db,
      llm: this.llm,
      cfg: this.cfg,
      tools: this.tools,
      skills: this.skills
    }
    const agentInfo = { id: a.row.id, name: a.row.name, traits: a.row.traits }

    try {
      const summary = await runTask(ctx, agentInfo, task, thought => {
        this.bubble(a.row.id, thought, 12_000)
      })
      this.db.setTask(taskId!, 'done', summary)
      this.db.addMemory(a.row.id, 'task', `Task "${task.title}": ${summary}`)
      this.onEvent(`${a.row.name} finished "${task.title}" — ${summary.slice(0, 80)}`)
      this.bubble(a.row.id, 'done ✓', 6000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.db.setTask(taskId!, 'failed', msg)
      this.db.addMemory(a.row.id, 'task', `Failed task "${task.title}": ${msg}`)
      this.onEvent(`${a.row.name} could not finish "${task.title}" — ${msg.slice(0, 80)}`)
      this.bubble(a.row.id, 'hit a snag', 6000)
    } finally {
      a.workRunning = false
      a.status = 'idle'
    }
  }

  /** Two idle agents near each other sometimes chat (rate-limited). */
  private maybeChat(now: number): void {
    if (now - this.lastChat < 10 * 60_000) return
    if (Math.random() > this.cfg.chatChance * 4) return
    const idle = this.list().filter(a => a.status === 'idle' && a.row.id !== BOSS_ID)
    for (let i = 0; i < idle.length; i++) {
      for (let j = i + 1; j < idle.length; j++) {
        const A = idle[i]!
        const B = idle[j]!
        if (Math.hypot(A.x - B.x, A.y - B.y) < 5) {
          this.lastChat = now
          void this.doChat(A, B)
          return
        }
      }
    }
  }

  private async doChat(A: SimAgent, B: SimAgent): Promise<void> {
    const ctx = {
      db: this.db,
      llm: this.llm,
      cfg: this.cfg,
      tools: this.tools,
      skills: this.skills
    }
    try {
      A.status = B.status = 'chatting'
      const lineA = await oneLiner(
        ctx,
        `You are ${A.row.name}. ${A.row.traits} Say ONE short casual work line (max 12 words) to your coworker ${B.row.name}.`,
        `You two work in the same small office. Say hi or something work-related.`
      )
      this.bubble(A.row.id, lineA || 'morning!', 5000)
      this.onEvent(`${A.row.name}: ${lineA || 'morning!'}`)

      const lineB = await oneLiner(
        ctx,
        `You are ${B.row.name}. ${B.row.traits} Reply to ${A.row.name} with ONE short casual line (max 12 words).`,
        `${A.row.name} said: "${lineA}". Reply.`
      )
      this.bubble(B.row.id, lineB || 'sounds good', 5000)
      this.onEvent(`${B.row.name}: ${lineB || 'sounds good'}`)

      this.db.addMemory(A.row.id, 'chat', `Chatted with ${B.row.name}, I said: "${lineA}"`)
      this.db.addMemory(B.row.id, 'chat', `Chatted with ${A.row.name}, they said: "${lineA}", I replied: "${lineB}"`)
    } catch {
      // chat is best-effort; Ollama may be asleep — ignore
    } finally {
      A.status = B.status = 'idle'
      A.lastChat = B.lastChat = Date.now()
    }
  }

  /** Every N minutes one idle agent has a passing thought. */
  private maybeThink(now: number): void {
    if (now - this.lastThink < this.cfg.idleThinkMinutes * 60_000) return
    const idle = this.list().filter(a => a.status === 'idle' && a.row.id !== BOSS_ID)
    if (idle.length === 0) return
    this.lastThink = now
    const a = idle[Math.floor(Math.random() * idle.length)]!
    void (async () => {
      const ctx = {
        db: this.db,
        llm: this.llm,
        cfg: this.cfg,
        tools: this.tools,
        skills: this.skills
      }
      try {
        a.status = 'thinking'
        const thought = await oneLiner(
          ctx,
          `You are ${a.row.name}. ${a.row.traits} Produce ONE short idle thought about your work day (max 12 words).`,
          `Just a passing thought while you wait at your desk.`
        )
        if (a.status === 'thinking') {
          this.bubble(a.row.id, thought || '...', 8000)
          this.db.addMemory(a.row.id, 'thought', thought)
        }
      } catch {
        // ignore
      } finally {
        if (a.status === 'thinking') a.status = 'idle'
      }
    })()
  }

  runtime(): { db: Db; llm: Llm; cfg: AppConfig; skills: SkillRegistry; tools: ToolDef[] } {
    return { db: this.db, llm: this.llm, cfg: this.cfg, skills: this.skills, tools: this.tools }
  }
}
