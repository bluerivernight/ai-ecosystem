// Structured logging: console capture (ring buffer), rolling file log, crash reports.
// Crash reports land in data/logs/crash-*.json — the report tool and /api/diagnostics read them.

import { mkdirSync, appendFileSync, writeFileSync, existsSync, statSync, renameSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, appRoot } from './config.js'

export const LOGS_DIR = path.join(DATA_DIR, 'logs')
const SERVER_LOG = path.join(LOGS_DIR, 'server.log')
const MAX_LOG_BYTES = 1_000_000 // rotate at ~1 MB, keeps one old copy
const RING_SIZE = 300

const ring: string[] = []

let VERSION = 'unknown'
try {
  const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string }
  VERSION = String(pkg.version ?? 'unknown')
} catch { /* keep unknown */ }
export const version = VERSION

function stamp(): string {
  return new Date().toISOString()
}

export function recordLine(level: string, args: unknown[]): void {
  const parts = args.map(a => {
    if (a instanceof Error) return a.stack ?? a.message
    if (typeof a === 'string') return a
    try { return JSON.stringify(a) } catch { return String(a) }
  })
  const line = `${stamp()} [${level}] ${parts.join(' ')}`
  ring.push(line)
  if (ring.length > RING_SIZE) ring.shift()
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })
    if (existsSync(SERVER_LOG) && statSync(SERVER_LOG).size > MAX_LOG_BYTES) {
      renameSync(SERVER_LOG, `${SERVER_LOG}.1`)
    }
    appendFileSync(SERVER_LOG, line + '\n')
  } catch { /* disk problem — never crash over logging */ }
}

export function install(): void {
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log = (...args: unknown[]) => { recordLine('info', args); orig.log(...args) }
  console.warn = (...args: unknown[]) => { recordLine('warn', args); orig.warn(...args) }
  console.error = (...args: unknown[]) => { recordLine('error', args); orig.error(...args) }
}

export function recentLines(n = 100): string[] {
  return ring.slice(-n)
}

export function writeCrash(kind: string, err: unknown): string | null {
  try {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true })
    const e = err instanceof Error ? err : new Error(String(err))
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(LOGS_DIR, `crash-${ts}.json`)
    writeFileSync(file, JSON.stringify({
      time: stamp(),
      kind,
      message: e.message,
      stack: e.stack,
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      lastLines: recentLines(50)
    }, null, 2))
    return file
  } catch { return null }
}

export function crashFiles(): string[] {
  try {
    return readdirSync(LOGS_DIR).filter(f => f.startsWith('crash-')).sort().reverse()
  } catch { return [] }
}
