// Main client loop: 30 fps cap, pause when hidden, WASD walk, E to assign.

import { TILE, MAP_W, MAP_H } from '../shared/map.js'
import { ClientNet } from './net.js'
import { Renderer, type UserInfo } from './render.js'
import { tryMove } from './move.js'

const FPS_MS = 1000 / 30

const canvas = document.getElementById('game') as HTMLCanvasElement
const net = new ClientNet()
const events = document.getElementById('event-log')!
const taskList = document.getElementById('task-list')!

// ---- user state (client-authoritative) ----
const user: UserInfo = { x: 20.5, y: 12.5, walkPhase: 0 }
const keys = new Set<string>()

window.addEventListener('keydown', e => {
  if (dialogOpen()) {
    if (e.key === 'Escape') closeDialog()
    return
  }
  keys.add(e.key.toLowerCase())
  if (e.key.toLowerCase() === 'e') tryAssign()
})
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()))

const renderer = new Renderer(canvas, () => user)

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

// ---- assign dialog ----
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

function nearestAgent(): { id: number; dist: number } | null {
  let best: { id: number; dist: number } | null = null
  for (const a of net.agents) {
    const d = Math.hypot(a.x - user.x, a.y - user.y)
    if (d < 2.2 && (!best || d < best.dist)) best = { id: a.id, dist: d }
  }
  return best
}

function tryAssign(): void {
  if (!dialogOpen() && nearestAgent()) openDialog()
}

// ---- loop ----
net.connect()

let lastDraw = 0
let camX = 0
let camY = 0

function centerCamera(): void {
  const worldW = MAP_W * TILE
  const worldH = MAP_H * TILE
  camX = Math.max(0, Math.min(worldW - canvas.width, user.x * TILE - canvas.width / 2))
  camY = Math.max(0, Math.min(worldH - canvas.height, user.y * TILE - canvas.height / 2))
  if (worldW < canvas.width) camX = -(canvas.width - worldW) / 2
  if (worldH < canvas.height) camY = -(canvas.height - worldH) / 2
}

function tickUser(dt: number): void {
  let dx = 0
  let dy = 0
  if (keys.has('w') || keys.has('arrowup')) dy -= 1
  if (keys.has('s') || keys.has('arrowdown')) dy += 1
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1
  if (keys.has('d') || keys.has('arrowright')) dx += 1
  if (dx === 0 && dy === 0) return
  const speed = 4.5 * dt
  let moved = false
  if (dx !== 0) {
    const [nx, ny] = tryMove(user.x, user.y, Math.sign(dx) * Math.min(1, Math.abs(dx) * speed + 0.51), 0)
    if (nx !== user.x) { user.x += Math.sign(nx - user.x) * Math.min(speed, Math.abs(nx - user.x)); moved = true }
  }
  if (dy !== 0) {
    const [nx, ny] = tryMove(user.x, user.y, 0, Math.sign(dy) * Math.min(1, Math.abs(dy) * speed + 0.51))
    if (ny !== user.y) { user.y += Math.sign(ny - user.y) * Math.min(speed, Math.abs(ny - user.y)); moved = true }
  }
  if (moved) user.walkPhase += dt * 8
}

let prev = performance.now()
function loop(now: number): void {
  requestAnimationFrame(loop)
  if (document.hidden) return // zero GPU/CPU when tab is hidden
  if (now - lastDraw < FPS_MS) return
  lastDraw = now

  const dt = Math.min(0.1, (now - prev) / 1000)
  prev = now
  tickUser(dt)
  centerCamera()
  const near = nearestAgent()
  renderer.draw(net.agents, near?.id ?? null, net.connected ? Date.now() : 0, camX, camY)
}
requestAnimationFrame(loop)

net.onStateChange = () => {
  const badge = document.title
  document.title = net.connected ? badge.replace(' ⚠', '') : badge + ' ⚠'
}

// ---- update banner ----
const updateBanner = document.getElementById('update-banner')!
async function checkUpdate(): Promise<void> {
  try {
    const u = await (await fetch('/api/update')).json() as { updateAvailable: boolean; latest: string | null }
    if (u.updateAvailable && u.latest) {
      document.getElementById('ub-version')!.textContent = u.latest
      updateBanner.style.display = 'flex'
    }
  } catch { /* server unreachable — ignore */ }
}
void checkUpdate()
setInterval(checkUpdate, 60_000)
document.getElementById('ub-ok')!.onclick = () => { updateBanner.style.display = 'none' }
