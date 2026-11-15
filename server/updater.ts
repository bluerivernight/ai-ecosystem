// Auto-updater: compares package.json's version against the GitHub repo's
// package.json (raw). Re-checks every 6 hours. Never downloads anything —
// it only reports so the UI can show "run update.bat".

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { appRoot } from './config.js'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdateStatus {
  current: string
  latest: string | null
  updateAvailable: boolean
  checkedAt: string | null
  error: string | null
  url: string | null
}

function currentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string }
    return String(pkg.version ?? '0.0.0')
  } catch { return '0.0.0' }
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split('.').map(n => parseInt(n, 10) || 0)
  const c = current.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const lv = l[i] ?? 0
    const cv = c[i] ?? 0
    if (lv !== cv) return lv > cv
  }
  return false
}

export class Updater {
  private status: UpdateStatus
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(updateUrl: string) {
    this.status = {
      current: currentVersion(),
      latest: null,
      updateAvailable: false,
      checkedAt: null,
      error: null,
      url: updateUrl || null
    }
  }

  start(): void {
    void this.check()
    this.timer = setInterval(() => { void this.check() }, CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  get(): UpdateStatus {
    return this.status
  }

  private async check(): Promise<void> {
    if (!this.status.url) {
      this.status.error = 'updateUrl is empty in config.json — updater disabled'
      return
    }
    try {
      const res = await fetch(this.status.url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const pkg = await res.json() as { version?: string }
      const latest = String(pkg.version ?? '')
      if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`bad version in remote package.json: "${latest}"`)
      this.status.latest = latest
      this.status.updateAvailable = isNewer(latest, this.status.current)
      this.status.checkedAt = new Date().toISOString()
      this.status.error = null
      if (this.status.updateAvailable) {
        console.log(`[update] new version available: ${latest} (running ${this.status.current}) — run update.bat`)
      }
    } catch (e) {
      // offline is normal — just remember the last good state
      this.status.error = e instanceof Error ? e.message : String(e)
    }
  }
}
