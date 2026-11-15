// The agent work loop. Event-driven (council): the LLM is invoked only when a
// task actually runs. One model, one inference slot at a time (enforced in llm.ts).
// Structured output forces every tool call to be schema-valid by construction.

import type { Db } from './db.js'
import type { Llm, ChatMessage } from './llm.js'
import type { ToolDef } from './tools.js'
import type { SkillRegistry } from './skills.js'
import type { AppConfig } from './config.js'

export interface RunContext {
  db: Db
  llm: Llm
  cfg: AppConfig
  tools: ToolDef[]
  skills: SkillRegistry
}

export interface AgentInfo {
  id: number
  name: string
  traits: string
}

const CALL_SCHEMA = {
  type: 'object',
  properties: {
    thought: { type: 'string', description: 'one short sentence about what you are doing' },
    tool: { type: 'string', description: 'tool name, or "finish"' },
    args: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        query: { type: 'string' },
        command: { type: 'string' },
        summary: { type: 'string', description: 'required when tool is "finish"' }
      },
      required: []
    }
  },
  required: ['thought', 'tool', 'args']
} as const

function parseCall(raw: string): { thought: string; tool: string; args: Record<string, unknown> } {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  const obj = JSON.parse(text) as { thought?: string; tool?: string; args?: Record<string, unknown> }
  if (!obj.tool) throw new Error('model did not choose a tool')
  return { thought: obj.thought ?? '', tool: obj.tool, args: obj.args ?? {} }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function systemPrompt(
  ctx: RunContext,
  agent: AgentInfo,
  taskText: string
): string {
  const today = new Date().toISOString().slice(0, 10)
  const toolList = ctx.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
  const memRecent = ctx.db.recentMemories(agent.id, 6).map(m => `- ${truncate(m, 120)}`).join('\n')
  const memMatched = ctx.db
    .matchedMemories(agent.id, taskText.toLowerCase().split(/\W+/))
    .map(m => `- ${truncate(m, 120)}`)
    .join('\n')
  const matched = ctx.skills.match(taskText)

  return [
    `You are ${agent.name}, an office worker in a small pixel-art AI office.`,
    agent.traits,
    `Today is ${today}. You work inside the folder "workspace" — file paths are relative to it.`,
    '',
    'TOOLS:',
    toolList,
    '',
    'RULES:',
    '- Reply ONLY with the JSON tool call the schema asks for.',
    '- Do one small step per call. Prefer read/list before write.',
    '- To complete the task, call tool "finish" with a short summary in args.summary.',
    '- If a tool fails, try a different approach once, then finish with what you have.',
    '- Keep files small. Write useful, complete content when writing files.',
    matched.length ? ctx.skills.promptText(matched) : '',
    '',
    'YOUR RECENT MEMORY:',
    memRecent || '- (nothing yet, this is your first day)',
    memMatched ? 'RELATED MEMORY:\n' + memMatched : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Runs one task to completion. Resolves with the finish summary. Throws on failure. */
export async function runTask(
  ctx: RunContext,
  agent: AgentInfo,
  task: { id: number; title: string; body: string },
  onStep?: (thought: string) => void
): Promise<string> {
  const cfg = ctx.cfg
  const toolNames = [...ctx.tools.map(t => t.name), 'finish']
  const schema = {
    type: 'object',
    properties: {
      thought: CALL_SCHEMA.properties.thought,
      tool: { type: 'string', enum: toolNames },
      args: CALL_SCHEMA.properties.args
    },
    required: ['thought', 'tool', 'args']
  }

  const base: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx, agent, task.body) },
    { role: 'user', content: `TASK: ${task.title}\n\n${task.body}` }
  ]
  const history: ChatMessage[] = []

  for (let step = 0; step < cfg.stepCap; step++) {
    // keep only the most recent steps so a tiny context window is never overflowed
    const messages = [...base, ...history.slice(-8)]
    const raw = await ctx.llm.chat(cfg.model, messages, schema)
    const call = parseCall(raw)
    onStep?.(truncate(call.thought, 60))

    if (call.tool === 'finish') {
      const summary = String(call.args.summary ?? call.thought ?? 'done').slice(0, 400)
      return summary
    }

    const tool = ctx.tools.find(t => t.name === call.tool)
    let result: string
    if (!tool) {
      result = `unknown tool "${call.tool}". Available: ${toolNames.join(', ')}`
    } else {
      try {
        result = await tool.exec(call.args)
      } catch (e) {
        result = `tool error: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`
      }
    }
    result = truncate(result, 1500)

    history.push({ role: 'assistant', content: JSON.stringify(call) })
    history.push({ role: 'user', content: `Result of ${call.tool}:\n${result}` })
  }

  throw new Error(`step cap (${cfg.stepCap}) reached without finishing`)
}

/** One-line chat or thought — cheap single call, no tools. */
export async function oneLiner(
  ctx: RunContext,
  system: string,
  user: string
): Promise<string> {
  const schema = {
    type: 'object',
    properties: { line: { type: 'string' } },
    required: ['line']
  }
  const raw = await ctx.llm.chat(
    ctx.cfg.model,
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    schema,
    60_000
  )
  const parsed = parseJsonish(raw) as { line?: string }
  return (parsed.line ?? '').slice(0, 120)
}

function parseJsonish(raw: string): unknown {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]!.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  return JSON.parse(text)
}
