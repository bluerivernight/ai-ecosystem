// Sandboxed tool executor. Security floor from the council:
// - file tools are confined to <project>/data/workspace
// - run_shell has a command whitelist and dangerous characters rejected
// - outputs are truncated so a tiny context window never overflows

import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { WORKSPACE_DIR } from './config.js'
import type { AppConfig } from './config.js'

export interface ToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required: string[]
  }
  exec: (args: Record<string, unknown>) => Promise<string>
}

function safeJoin(rel: unknown): string {
  const relStr = String(rel ?? '.')
  const resolved = path.resolve(WORKSPACE_DIR, relStr)
  if (!resolved.startsWith(path.resolve(WORKSPACE_DIR))) {
    throw new Error('Path must stay inside the workspace folder')
  }
  return resolved
}

const FORBIDDEN_CHARS = /[|<>&;`$"\\]/ // pipes, redirects, command chaining — rejected outright

export function buildTools(cfg: AppConfig): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: 'read_file',
      description: 'Read a text file from the workspace. Path is relative to the workspace root.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'relative path, e.g. notes/today.md' } },
        required: ['path']
      },
      exec: async args => {
        const p = safeJoin(args.path)
        const text = await fs.readFile(p, 'utf8')
        return text.slice(0, 4000)
      }
    },
    {
      name: 'write_file',
      description: 'Write (or overwrite) a text file in the workspace. Parent folders are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'relative path, e.g. notes/today.md' },
          content: { type: 'string', description: 'full file content' }
        },
        required: ['path', 'content']
      },
      exec: async args => {
        const p = safeJoin(args.path)
        await fs.mkdir(path.dirname(p), { recursive: true })
        await fs.writeFile(p, String(args.content ?? ''), 'utf8')
        return `wrote ${args.path} (${String(args.content ?? '').length} chars)`
      }
    },
    {
      name: 'list_files',
      description: 'List files and folders in a workspace directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'relative folder, "." for root' } },
        required: ['path']
      },
      exec: async args => {
        const p = safeJoin(args.path ?? '.')
        const entries = await fs.readdir(p, { withFileTypes: true })
        return entries.map(e => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n') || '(empty)'
      }
    },
    {
      name: 'web_search',
      description:
        'Search the web via DuckDuckGo (free, no API key). Returns top result titles and links. Works only when the machine is online.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search query' } },
        required: ['query']
      },
      exec: async args => {
        const q = encodeURIComponent(String(args.query ?? '').slice(0, 200))
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(15_000)
        })
        if (!res.ok) return `search failed: HTTP ${res.status}`
        const html = await res.text()
        const results: string[] = []
        const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null && results.length < 6) {
          const title = m[2]!.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
          const url = decodeURIComponent((m[1] ?? '').match(/uddg=([^&]+)/)?.[1] ?? m[1] ?? '')
          if (title) results.push(`${title} — ${url}`)
        }
        return results.length ? results.join('\n') : 'no results found'
      }
    }
  ]

  tools.push({
    name: 'run_shell',
    description:
      'Run ONE allowlisted command inside the workspace folder (cwd = workspace). Only the first word of the command is checked against the whitelist.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'e.g. "dir" or "node script.js"' } },
      required: ['command']
    },
    exec: async args => {
      const command = String(args.command ?? '').trim()
      if (FORBIDDEN_CHARS.test(command)) return 'rejected: command contains forbidden characters'
      const first = command.split(/\s+/)[0]?.toLowerCase() ?? ''
      if (!cfg.shellWhitelist.includes(first)) {
        return `rejected: "${first}" is not on the allowlist (${cfg.shellWhitelist.join(', ')})`
      }
      return new Promise(resolve => {
        exec(
          command,
          { cwd: WORKSPACE_DIR, timeout: 30_000, windowsHide: true, maxBuffer: 1 << 20 },
          (err, stdout, stderr) => {
            const out = [stdout?.toString(), stderr?.toString()].filter(Boolean).join('\n')
            if (err) resolve(`error: ${String(err.message).slice(0, 300)}\n${out.slice(0, 3000)}`)
            else resolve(out.slice(0, 4000) || '(no output)')
          }
        )
      })
    }
  })

  return tools
}
