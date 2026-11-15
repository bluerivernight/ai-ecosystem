// Ollama client. HARD RULE from the council: one inference at a time.
// All agents queue through a single promise chain. Structured output via
// Ollama's `format` parameter forces schema-valid tool calls by construction.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface OllamaModel {
  name: string
  size: number
}

// families that are known to chat + take JSON-schemas well, small-first
const PREFERRED = [
  'qwen2.5:0.5b-instruct', 'qwen2.5:1.5b-instruct', 'llama3.2:1b', 'gemma3:1b', 'phi3.5',
  'qwen3:0.6b', 'qwen3:1.7b',
  'qwen2.5:3b-instruct', 'llama3.2:3b', 'gemma3:4b', 'phi3:mini', 'qwen2.5-coder:1.5b',
  'mistral:7b', 'qwen2.5:7b-instruct', 'llama3.1:8b', 'qwen2.5-coder:7b'
]

// embedders / vision-only models can't run the office — never auto-pick them
const NON_CHAT = /embed|vl|vision|llava|minicpm|nomic|bge|mxbai|all-minilm|snowflake|guard/i

const MAX_BYTES = 5 * 1024 * 1024 * 1024 // ~5 GB on disk ≈ the ceiling for 8 GB RAM

/** Pick the best installed chat model for this machine (small, instruct-ish). */
export function pickChatModel(models: OllamaModel[]): OllamaModel | null {
  const chat = models.filter(m => !NON_CHAT.test(m.name) && m.size > 0 && m.size <= MAX_BYTES)
  if (chat.length === 0) return null
  let best: OllamaModel | null = null
  let bestScore = Infinity
  for (const m of chat) {
    const pi = PREFERRED.findIndex(p => m.name.startsWith(p))
    const score = (pi === -1 ? PREFERRED.length + 1 : pi) * 1000 + m.size / 1e9
    if (score < bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

export class Llm {
  private tail: Promise<unknown> = Promise.resolve()
  private lastError = ''

  constructor(
    private ollamaUrl: string,
    private numCtx: number,
    private numPredict: number,
    private keepAlive: string
  ) {}

  // serialized: every chat waits for the previous one to finish
  chat(model: string, messages: ChatMessage[], format: object, timeoutMs = 120_000): Promise<string> {
    const run = this.tail.then(async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(`${this.ollamaUrl}/api/chat`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            format, // structured output — JSON schema
            keep_alive: this.keepAlive,
            options: {
              num_ctx: this.numCtx,
              num_predict: this.numPredict,
              temperature: 0.3
            }
          })
        })
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`)
        const data = (await res.json()) as { message?: { content?: string } }
        return data.message?.content ?? ''
      } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e)
        throw e
      } finally {
        clearTimeout(timer)
      }
    })
    // keep the chain alive even when a call fails
    this.tail = run.catch(() => undefined)
    return run
  }

  lastErrorMessage(): string {
    return this.lastError
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async hasModel(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return false
      const data = (await res.json()) as { models?: Array<{ name?: string }> }
      // exact name match — prefix matching once falsely matched qwen2.5vl:3b for qwen2.5:1.5b
      return (data.models ?? []).some(m => m.name === model)
    } catch {
      return false
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return []
      const data = (await res.json()) as { models?: Array<{ name?: string; size?: number }> }
      return (data.models ?? []).map(m => ({ name: m.name ?? '', size: m.size ?? 0 })).filter(m => m.name)
    } catch {
      return []
    }
  }

  /** Pull a model, streaming progress (percent) to the callback. Throws on Ollama errors. */
  async pull(model: string, onProgress: (p: { status: string; percent: number }) => void): Promise<void> {
    const res = await fetch(`${this.ollamaUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true })
    })
    if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let j: { status?: string; error?: string; total?: number; completed?: number }
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        if (j.error) throw new Error(String(j.error))
        const percent = j.total && j.completed ? Math.round((j.completed / j.total) * 100) : -1
        onProgress({ status: j.status ?? '', percent })
      }
    }
  }
}
