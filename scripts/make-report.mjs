// Collects everything needed to report a bug into one folder (data/report/):
// - crash reports from data/logs/crash-*.json (last 10)
// - tail of data/logs/server.log
// - live diagnostics from the running server (if it is running)
// Then report-log.bat zips the folder — the user sends that one .zip.

import { mkdirSync, writeFileSync, readdirSync, readFileSync, copyFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOGS_DIR = path.join(ROOT, 'data', 'logs')
const REPORT_DIR = path.join(ROOT, 'data', 'report')
const TAIL_LINES = 400

mkdirSync(REPORT_DIR, { recursive: true })

// 1. crash reports, newest 10
let crashes = 0
try {
  if (existsSync(LOGS_DIR)) {
    const files = readdirSync(LOGS_DIR).filter(f => f.startsWith('crash-')).sort().reverse().slice(0, 10)
    for (const f of files) { copyFileSync(path.join(LOGS_DIR, f), path.join(REPORT_DIR, f)); crashes++ }
  }
} catch (e) { console.warn('could not copy crash logs:', e.message) }

// 2. server.log tail
try {
  const log = path.join(LOGS_DIR, 'server.log')
  if (existsSync(log)) {
    const lines = readFileSync(log, 'utf8').split('\n')
    writeFileSync(path.join(REPORT_DIR, 'server-log-tail.txt'), lines.slice(-TAIL_LINES).join('\n'))
  } else {
    writeFileSync(path.join(REPORT_DIR, 'server-log-tail.txt'), '(no server.log found — server was never started, or logging folder was cleaned)')
  }
} catch (e) { console.warn('could not tail server.log:', e.message) }

// 3. machine info
try {
  writeFileSync(path.join(REPORT_DIR, 'system-info.txt'), JSON.stringify({
    time: new Date().toISOString(),
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    node: process.version,
    freeMemoryMb: Math.round(os.freemem() / 1048576),
    totalMemoryMb: Math.round(os.totalmem() / 1048576)
  }, null, 2))
} catch (e) { console.warn('could not write system info:', e.message) }

// 4. live diagnostics from a running server (optional)
try {
  const res = await fetch('http://localhost:8080/api/diagnostics', { signal: AbortSignal.timeout(5000) })
  if (res.ok) {
    writeFileSync(path.join(REPORT_DIR, 'diagnostics.json'), JSON.stringify(await res.json(), null, 2))
    console.log('captured live diagnostics from the running server')
  } else {
    console.log(`server answered but not ok (HTTP ${res.status}) — check the port in config.json`)
  }
} catch {
  console.log('server not running — report contains crash logs + log tail only (still useful)')
}

console.log(`\nDone. ${crashes} crash report(s) collected.`)
console.log(`Send this file to the developer: data\\report.zip (created by report-log.bat)`)
