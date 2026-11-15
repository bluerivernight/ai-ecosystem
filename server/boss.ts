// The Boss: the one agent the human talks to. Knows everything about the
// office (workers, tasks, events, workspace files, chat history) and answers
// by (a) replying directly and/or (b) delegating tasks to the workers.
// Uses the same one-model slot as everyone else (serialized in llm.ts).

import type { Db } from './db.js'
import type { Llm } from './llm.js'
import type { ToolDef } from './tools.js'
import type { AppConfig } from './config.js'
import { BOSS_ID } from '../shared/types.js'

export interface BossContext {
  db: Db
  llm: Llm
  cfg: AppConfig
  tools: ToolDef[]
}

export interface BossCallbacks {
  onEvent: (text: string) => void
  onReply: (reply: string) => void
  assign: (taskId: number, agentId: number) => void
}

const BOSS_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'what you say back to the human. Short, friendly, clear. 1-4 sentences.' },
    tasks: {
      type: 'array',
      description: 'tasks to delegate to workers. Empty array if none are needed.',
      items: {
        type: 'object',
        properties: {
          agentName: { type: 'string', description: 'worker name, exactly one of: Nova, Rex, Pixel, Byte' },
          title: { type: 'string', description: 'short task title, max 60 chars' },
          body: { type: 'string', description: 'detailed instructions for the worker' }
        },
        required: ['agentName', 'title', 'body']
      }
    }
  },
  required: ['reply', 'tasks']
} as const

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

interface BossOutput {
  reply: string
  tasks: Array<{ agentName: string; title: string; body: string }>
}

function parseBoss(raw: string): BossOutput {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  const obj = JSON.parse(text) as Partial<BossOutput>
  return { reply: String(obj.reply ?? ''), tasks: Array.isArray(obj.tasks) ? obj.tasks : [] }
}

export class Boss {
  constructor(
    private ctx: BossContext,
    private cb: BossCallbacks
  ) {}

  async handle(text: string): Promise<void> {
    const { db, llm, tools } = this.ctx
    const agents = db.getAgents()
    const workers = agents.filter(a => a.id !== BOSS_ID)
    const byName = new Map(workers.map(w => [w.name.toLowerCase(), w]))

    // office status snapshot (compact — tiny context window)
    const workerLines = workers
      .map(w => `- ${w.name}: ${w.traits}`)
      .join('\n')
    const taskLines = db
      .recentTasks(8)
      .map(t => `- [${t.status}] "${t.title}" (${t.agent_id === BOSS_ID ? 'delegated' : workers.find(w => w.id === t.agent_id)?.name ?? 'worker'})`)
      .join('\n')
    const eventLines = db
      .recentEvents(6)
      .map(e => `- ${truncate(e.text, 100)}`)
      .join('\n')
    const chatLines = db
      .recentChats(8)
      .reverse()
      .map(c => `- ${c.role === 'user' ? 'Human' : 'Boss'}: ${truncate(c.text, 200)}`)
      .join('\n')
    let workspace = '(unavailable)'
    try {
      const listTool = tools.find(t => t.name === 'list_files')
      if (listTool) workspace = truncate(await listTool.exec({ path: '.' }), 400) || '(empty)'
    } catch { /* keep placeholder */ }

    const system = [
      'You are the Boss of a small AI office. The human only talks to you, never to workers directly.',
      'You know everything happening in the office. You can answer questions yourself AND delegate work.',
      'Delegate real work (files, research, commands) to workers; answer small talk and status questions yourself.',
      'Delegate only when the human asks for something to be DONE. One request may produce 0-2 tasks, never more.',
      '',
      'WORKERS:',
      workerLines,
      '',
      `CURRENT TASKS (newest first):`,
      taskLines || '(none yet)',
      '',
      'RECENT OFFICE EVENTS:',
      eventLines || '(quiet)',
      '',
      `WORKSPACE FILES: ${workspace}`,
      '',
      'RECENT CONVERSATION:',
      chatLines || '(first message)'
    ].join('\n')

    try {
      const raw = await llm.chat(this.ctx.cfg.model, [
        { role: 'system', content: system },
        { role: 'user', content: truncate(text, 800) }
      ], BOSS_SCHEMA)
      const out = parseBoss(raw)

      // delegate
      for (const t of out.tasks.slice(0, 2)) {
        const worker = byName.get(String(t.agentName ?? '').toLowerCase())
        if (!worker || !t.title || !t.body) continue
        const id = db.addTask(worker.id, String(t.title).slice(0, 120), String(t.body).slice(0, 4000))
        this.cb.onEvent(`Boss delegated to ${worker.name}: "${String(t.title).slice(0, 60)}"`)
        this.cb.assign(id, worker.id)
      }

      const reply = out.reply.trim() || 'On it. I\'ll let you know how it goes.'
      this.cb.onReply(reply)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.cb.onReply(`Hmm, my head's not working right now (${truncate(msg, 80)}). Try again in a moment.`)
    }
  }
}
