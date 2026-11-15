// Main client loop: GOD-EYE VIEW (Sims style). The whole office is visible,
// no walking avatar. Click an agent to give them a task directly, or message
// the Boss in the side panel — he knows everything and delegates.

import { ClientNet } from './net.ts'
import { Renderer } from './render.ts'

const FPS_MS = 1000 / 30

const canvas = document.getElementById('game') as HTMLCanvasElement
const net = new ClientNet()
const events = document.getElementById('event-log')!
const taskList = document.getElementById('task-list')!

let selectedId: number | null = null

const renderer = new Renderer(canvas)

// ---- click: select an agent (for a direct task, optional — the Boss is the main way) ----
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect()
  const mx = ((e.clientX - rect.left) * canvas.width) / rect.width
  const my = ((e.clientY - rect.top) * canvas.height) / rect.height
  let hit: number | null = null
  for (const a of net.agents) {
    const ax = (a.x * 32) * renderer.scale
    const ay = (a.y * 32) * renderer.scale
    if (Math.hypot(ax - mx, ay - my) < 22) hit = a.id
  }
  selectedId = hit
})

// ---- side panels ----
net.onEvent = (text, ts) => {
  const div = document.createElement('div')
  const time = document.createElement('time')
  time.textContent = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  div.appendChild(time)
  div.appendChild(document.createTextNode(text))
  events.prepend(div)
  while (events.children.length > 40) events.lastChild?.remove()
}

function updatePanels(): void {
  document.getElementById('c-queued')!.textContent = String(net.taskCounts.queued)
  document.getElementById('c-active')!.textContent = String(net.taskCounts.active)
  document.getElementById('c-done')!.textContent = String(net.taskCounts.done)
}

setInterval(updatePanels, 500)
void fetch('/api/tasks')
  .then(r => r.json())
  .then((tasks: Array<{ id: number; title: string; status: string; result: string | null }>) => {
    for (const t of tasks.slice(0, 8)) {
      const div = document.createElement('div')
      div.className = 'task'
      div.innerHTML = `<span class="st ${t.status}">${t.status}</span> ${escapeHtml(t.title)}`
      taskList.appendChild(div)
    }
  })
  .catch(() => {})

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)
}

// ---- Boss chat (the main way to interact) ----
const chatLog = document.getElementById('chat-log')!
const chatInput = document.getElementById('chat-input') as HTMLInputElement

function addChatLine(role: 'user' | 'boss', text: string): void {
  const div = document.createElement('div')
  div.className = `msg ${role}`
  div.textContent = text
  chatLog.appendChild(div)
  chatLog.scrollTop = chatLog.scrollHeight
}

net.onBoss = (text) => {
  addChatLine('boss', text)
  setPending('')
}

// load past conversation (so a refresh keeps the chat)
void fetch('/api/chats')
  .then(r => r.json())
  .then((chats: Array<{ role: 'user' | 'boss'; text: string }>) => {
    for (const c of chats.reverse()) addChatLine(c.role, c.text)
  })
  .catch(() => {})

const pendingEl = document.getElementById('chat-pending')!

function setPending(text: string): void {
  pendingEl.textContent = text
}

let sending = false
async function sendToBoss(): Promise<void> {
  const text = chatInput.value.trim()
  if (!text || sending) return
  chatInput.value = ''
  addChatLine('user', text)
  sending = true
  setPending('Boss is thinking…')
  try {
    await fetch('/api/boss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
  } catch {
    setPending('Server unreachable.')
  } finally {
    sending = false
  }
}

document.getElementById('chat-send')!.onclick = sendToBoss
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') void sendToBoss()
})

// ---- assign dialog (optional direct task — power-user shortcut) ----
const dialog = document.getElementById('dialog')!
const dlgAgents = document.getElementById('dlg-agents')!
let pickedAgent: number | null = null

function dialogOpen(): boolean {
  return dialog.classList.contains('open')
}

function openDialog(): void {
  pickedAgent = null
  dlgAgents.innerHTML = ''
  for (const a of net.agents) {
    if (a.id === 5) continue // the Boss delegates — he doesn't take tasks
    const b = document.createElement('button')
    b.textContent = a.name
    b.style.background = a.shirt
    b.onclick = () => {
      pickedAgent = a.id
      for (const btn of dlgAgents.children) (btn as HTMLElement).classList.remove('sel')
      b.classList.add('sel')
    }
    dlgAgents.appendChild(b)
  }
  ;(document.getElementById('dlg-title-input') as HTMLInputElement).value = ''
  ;(document.getElementById('dlg-body') as HTMLTextAreaElement).value = ''
  dialog.classList.add('open')
  ;(document.getElementById('dlg-title-input') as HTMLInputElement).focus()
}

function closeDialog(): void {
  dialog.classList.remove('open')
  selectedId = null
}

document.getElementById('dlg-cancel')!.onclick = closeDialog
document.getElementById('dlg-send')!.onclick = sendTask

async function sendTask(): Promise<void> {
  const title = (document.getElementById('dlg-title-input') as HTMLInputElement).value.trim()
  const body = (document.getElementById('dlg-body') as HTMLTextAreaElement).value.trim()
  if (!pickedAgent || !title || !body) return
  closeDialog()
  try {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: pickedAgent, title, body })
    })
  } catch {
    // event log will show when the task starts anyway
  }
}

// ---- loop ----
net.connect()

let lastDraw = 0

function loop(now: number): void {
  requestAnimationFrame(loop)
  if (document.hidden) return // zero GPU/CPU when tab is hidden
  if (now - lastDraw < FPS_MS) return
  lastDraw = now
  renderer.draw(net.agents, selectedId, net.connected ? Date.now() : 0)
}
requestAnimationFrame(loop)

net.onStateChange = () => {
  const badge = document.title
  document.title = net.connected ? badge.replace(' ⚠', '') : badge + ' ⚠'
}
