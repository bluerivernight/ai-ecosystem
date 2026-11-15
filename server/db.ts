import Database from 'better-sqlite3'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import type { TaskRow } from '../shared/types.js'

export interface AgentRow {
  id: number
  name: string
  color: string
  shirt: string
  hair: string
  traits: string
}

export class Db {
  private db: Database.Database

  constructor(file = path.join(DATA_DIR, 'eco.db')) {
    this.db = new Database(file)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        shirt TEXT NOT NULL,
        hair TEXT NOT NULL,
        traits TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_mem_agent ON memories(agent_id, ts);
    `)
  }

  // ---- agents ----
  getAgents(): AgentRow[] {
    return this.db.prepare('SELECT * FROM agents ORDER BY id').all() as AgentRow[]
  }

  upsertAgent(a: AgentRow): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, color, shirt, hair, traits) VALUES (@id, @name, @color, @shirt, @hair, @traits)
         ON CONFLICT(id) DO UPDATE SET name=@name, color=@color, shirt=@shirt, hair=@hair, traits=@traits`
      )
      .run(a)
  }

  // ---- tasks ----
  addTask(agentId: number, title: string, body: string): number {
    const r = this.db
      .prepare('INSERT INTO tasks (agent_id, title, body, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(agentId, title, body, 'queued', Date.now())
    return Number(r.lastInsertRowid)
  }

  setTask(id: number, status: TaskRow['status'], result: string | null): void {
    this.db.prepare('UPDATE tasks SET status=?, result=? WHERE id=?').run(status, result, id)
  }

  getTask(id: number): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined
  }

  taskCounts(): { queued: number; active: number; done: number } {
    const r = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done
         FROM tasks`
      )
      .get() as { queued: number | null; active: number | null; done: number | null }
    return { queued: r.queued ?? 0, active: r.active ?? 0, done: r.done ?? 0 }
  }

  recentTasks(limit = 12): TaskRow[] {
    return this.db
      .prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT ?')
      .all(limit) as TaskRow[]
  }

  // ---- memories ----
  addMemory(agentId: number, kind: string, text: string): void {
    this.db
      .prepare('INSERT INTO memories (agent_id, kind, text, ts) VALUES (?, ?, ?, ?)')
      .run(agentId, kind, text.slice(0, 500), Date.now())
  }

  recentMemories(agentId: number, limit = 8): string[] {
    const rows = this.db
      .prepare('SELECT text FROM memories WHERE agent_id=? ORDER BY ts DESC LIMIT ?')
      .all(agentId, limit) as Array<{ text: string }>
    return rows.map(r => r.text)
  }

  matchedMemories(agentId: number, words: string[], limit = 4): string[] {
    if (words.length === 0) return []
    const like = words
      .filter(w => w.length > 3)
      .map(w => `%${w.replace(/[%_]/g, '')}%`)
    if (like.length === 0) return []
    const clauses = like.map(() => 'text LIKE ?').join(' OR ')
    const rows = this.db
      .prepare(
        `SELECT text FROM memories WHERE agent_id=? AND (${clauses}) ORDER BY ts DESC LIMIT ?`
      )
      .all(agentId, ...like, limit) as Array<{ text: string }>
    return rows.map(r => r.text)
  }

  // ---- events (rotated so the DB can't grow forever) ----
  addEvent(text: string): void {
    this.db.prepare('INSERT INTO events (ts, text) VALUES (?, ?)').run(Date.now(), text.slice(0, 300))
    // keep only the newest 2000 rows
    this.db
      .prepare(
        `DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 2000)`
      )
      .run()
  }

  recentEvents(limit = 8): Array<{ ts: number; text: string }> {
    return this.db
      .prepare('SELECT ts, text FROM events ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ ts: number; text: string }>
  }

  close(): void {
    this.db.close()
  }
}
