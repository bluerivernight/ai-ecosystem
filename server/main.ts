// Server entrypoint. One Node process serves everything:
// - static client build (dist-client)
// - /api routes (state, tasks)
// - WebSocket world stream
// - agent sim + tool runner + SQLite
// Headless flag: `node dist-server/server/main.js --headless` (24/7 mode)

import { createServer } from 'node:http'
import path from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { WebSocketServer } from 'ws'
import { loadConfig, ensureDirs, appRoot, WORKSPACE_DIR } from './config.js'
import * as logs from './logs.js'
import { Updater } from './updater.js'
import { Db } from './db.js'
import { Llm } from './llm.js'
import { buildTools } from './tools.js'
import { SkillRegistry } from './skills.js'
import { WorldSim } from './world.js'
import { Net } from './net.js'
import type { WorldMessage, EventMessage } from '../shared/types.js'

// capture console output into data/logs/server.log BEFORE anything else logs
logs.install()

const cfg = loadConfig()
ensureDirs()

const headless = process.argv.includes('--headless')
const app = express()

// ---- db + skills ----
const db = new Db()
const skills = new SkillRegistry()
skills.load()

// seed default agents once
const DEFAULT_AGENTS = [
  { name: 'Nova', color: '#7dd3fc', shirt: '#2563eb', hair: '#1f2937', traits: 'Optimistic, loves writing docs and notes. Speaks in short friendly lines.' },
  { name: 'Rex',  color: '#fca5a5', shirt: '#dc2626', hair: '#111827', traits: 'Blunt systems thinker. Loves shell commands and tidy folders.' },
  { name: 'Pixel',color: '#fcd34d', shirt: '#d97706', hair: '#7c2d12', traits: 'Curious researcher. Likes web search and summarizing findings.' },
  { name: 'Byte', color: '#a5b4fc', shirt: '#7c3aed', hair: '#4c1d95', traits: 'Quiet coder. Writes small, careful files and test scripts.' }
]
const existing = db.getAgents()
if (existing.length === 0) {
  DEFAULT_AGENTS.forEach((a, i) => db.upsertAgent({ id: i + 1, ...a }))
  console.log('[boot] seeded 4 default agents')
}

// ---- llm + tools + sim ----
const llm = new Llm(cfg.ollamaUrl, cfg.numCtx, cfg.numPredict, cfg.keepAlive)
const tools = buildTools(cfg)
const updater = new Updater(cfg.updateUrl)
let sim: WorldSim

// ---- static client ----
const distClient = path.join(appRoot, 'dist-client')
if (existsSync(distClient)) {
  app.use(express.static(distClient))
} else {
  console.warn('[boot] dist-client/ missing — run `npm run build` to build the browser world')
}

// ---- API ----
app.get('/api/state', (_req, res) => {
  res.json({
    agents: sim.snapshot(),
    taskCounts: db.taskCounts(),
    recentTasks: db.recentTasks(12),
    events: db.recentEvents(12),
    skills: skills.list().map(s => ({ name: s.name, description: s.description }))
  })
})

app.get('/api/tasks', (_req, res) => {
  res.json(db.recentTasks(50))
})

app.post('/api/tasks', express.json({ limit: '10kb' }), (req, res) => {
  const { agentId, title, body } = (req.body ?? {}) as { agentId?: number; title?: string; body?: string }
  if (!agentId || !title || !body) {
    res.status(400).json({ error: 'agentId, title and body are required' })
    return
  }
  const agent = db.getAgents().find(a => a.id === agentId)
  if (!agent) {
    res.status(404).json({ error: 'unknown agent' })
    return
  }
  const id = db.addTask(agentId, String(title).slice(0, 120), String(body).slice(0, 4000))
  db.addEvent(`New task for ${agent.name}: "${String(title).slice(0, 60)}"`)
  sim.assign(id, agentId)
  res.json({ id })
})

app.get('/api/events', (_req, res) => {
  res.json(db.recentEvents(50))
})

app.get('/health', async (_req, res) => {
  const ollamaOk = await llm.healthy()
  const modelOk = ollamaOk ? await llm.hasModel(cfg.model) : false
  res.json({
    ok: true,
    model: cfg.model,
    ollama: ollamaOk,
    modelLoaded: modelOk,
    clients: net.clientCount(),
    headless
  })
})

// full state dump for remote bug reports (report-log.bat uses this too)
app.get('/api/diagnostics', async (_req, res) => {
  const ollamaOk = await llm.healthy()
  const modelOk = ollamaOk ? await llm.hasModel(cfg.model) : false
  res.json({
    version: logs.version,
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    memoryRssMb: Math.round(process.memoryUsage().rss / 1048576),
    config: { port: cfg.port, model: cfg.model, numCtx: cfg.numCtx, numPredict: cfg.numPredict, updateUrl: cfg.updateUrl },
    health: { ok: true, ollama: ollamaOk, modelLoaded: modelOk, clients: net.clientCount(), headless },
    crashFiles: logs.crashFiles(),
    recentLog: logs.recentLines(80)
  })
})

app.get('/api/update', (_req, res) => {
  res.json(updater.get())
})

// ---- server + ws ----
const server = createServer(app)
const net = new Net()
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
  } else {
    socket.destroy()
  }
})
net.attach(wss)

sim = new WorldSim(db, cfg, llm, skills, tools, text => {
  db.addEvent(text)
  const ev: EventMessage = { type: 'event', text, ts: Date.now() }
  net.broadcastEvent(ev)
})

// ---- auto-update check ----
updater.start()

// ---- sim loop: 4 Hz tick + snapshot broadcast ----
const TICK_MS = 250
let last = Date.now()
const timer = setInterval(() => {
  const now = Date.now()
  const dt = (now - last) / 1000
  last = now
  try {
    sim.tick(dt)
    const msg: WorldMessage = {
      type: 'world',
      t: now,
      agents: sim.snapshot(),
      taskCounts: db.taskCounts()
    }
    net.broadcastWorld(msg)
  } catch (e) {
    console.error('[tick] error (sim keeps running):', e instanceof Error ? e.message : e)
  }
}, TICK_MS)

// don't keep the process alive on the interval alone when closing
timer.unref?.()

server.listen(cfg.port, () => {
  console.log(`[boot] AI Ecosystem server on http://localhost:${cfg.port}${headless ? ' (headless)' : ''}`)
  console.log(`[boot] workspace: ${WORKSPACE_DIR}`)
})

// health checks on boot (non-fatal — the server still runs without Ollama)
void (async () => {
  const ok = await llm.healthy()
  if (!ok) {
    console.warn('[boot] Ollama not reachable — agents will idle until it starts. Run: ollama serve')
  } else {
    const has = await llm.hasModel(cfg.model)
    console.log(has ? `[boot] model ready: ${cfg.model}` : `[boot] model missing — run: ollama pull ${cfg.model}`)
  }
})()

// ---- graceful shutdown ----
function shutdown(): void {
  console.log('[shutdown] closing…')
  updater.stop()
  clearInterval(timer)
  net.close()
  server.close()
  db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('uncaughtException', err => {
  const file = logs.writeCrash('uncaughtException', err)
  console.error(`[fatal] uncaught exception${file ? ` (crash report: ${file})` : ''}:`, err)
  shutdown()
})
process.on('unhandledRejection', err => {
  const file = logs.writeCrash('unhandledRejection', err)
  // don't kill the sim over one rejected promise — log it and keep running
  console.error(`[fatal] unhandled rejection (server keeps running)${file ? ` (crash report: ${file})` : ''}:`, err)
})
