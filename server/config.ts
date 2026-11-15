import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface AppConfig {
  port: number
  ollamaUrl: string
  model: string
  bigModel: string
  maxAgents: number
  stepCap: number
  numCtx: number
  numPredict: number
  keepAlive: string
  idleThinkMinutes: number
  chatChance: number
  shellWhitelist: string[]
  updateUrl: string
}

// compiled output lives at dist-server/server/config.js → root is two levels up
const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const WORKSPACE_DIR = path.join(DATA_DIR, 'workspace')
export const SKILLS_DIR = path.join(ROOT, 'skills')

export const appRoot = ROOT

export function loadConfig(): AppConfig {
  const file = path.join(ROOT, 'config.json')
  let user: Partial<AppConfig> = {}
  if (existsSync(file)) {
    try {
      user = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppConfig>
    } catch {
      console.error('[config] config.json is not valid JSON — using defaults')
    }
  } else {
    writeFileSync(file, JSON.stringify(defaults(), null, 2))
  }
  return { ...defaults(), ...user }
}

function defaults(): AppConfig {
  return {
    port: 8080,
    ollamaUrl: 'http://localhost:11434',
    model: 'qwen2.5:1.5b-instruct-q4_K_M',
    bigModel: 'qwen2.5:3b-instruct-q4_K_M',
    maxAgents: 5,
    stepCap: 12,
    numCtx: 2048,
    numPredict: 300,
    keepAlive: '5m',
    idleThinkMinutes: 25,
    chatChance: 0.015,
    shellWhitelist: ['node', 'python', 'git', 'npm', 'dir', 'type', 'echo'],
    // checked by the auto-updater (raw package.json on GitHub). Empty = updater off.
    updateUrl: 'https://raw.githubusercontent.com/bluerivernight/ai-ecosystem/main/package.json'
  }
}

export function ensureDirs(): void {
  for (const d of [DATA_DIR, WORKSPACE_DIR]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
}
