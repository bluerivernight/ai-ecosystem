// Shared types between server and client

export interface AgentSnapshot {
  id: number
  name: string
  color: string
  shirt: string
  hair: string
  x: number // tile coords (float)
  y: number
  facing: 'down' | 'up' | 'left' | 'right'
  status: 'idle' | 'walking' | 'working' | 'thinking' | 'chatting'
  bubble: string | null
}

export interface WorldMessage {
  type: 'world'
  t: number
  agents: AgentSnapshot[]
  taskCounts: { queued: number; active: number; done: number }
}

export interface EventMessage {
  type: 'event'
  text: string
  ts: number
}

/** The Boss agent's reply to the human, pushed over WS after processing. */
export interface BossMessage {
  type: 'boss'
  text: string
  ts: number
}

/** Agent id reserved for the Boss — never receives tasks, never does idle thinking. */
export const BOSS_ID = 5

export interface ClientMessage {
  type: 'hello'
}

export interface TaskRow {
  id: number
  agent_id: number
  title: string
  body: string
  status: 'queued' | 'active' | 'done' | 'failed'
  result: string | null
  created_at: number
}

export interface SkillManifest {
  name: string
  description: string
  instructions: string
  keywords?: string[]
  tools?: string[]
}

export interface ChatRow {
  id: number
  role: 'user' | 'boss'
  text: string
  ts: number
}
