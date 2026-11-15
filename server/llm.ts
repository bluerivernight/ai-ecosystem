// Ollama client. HARD RULE from the council: one inference at a time.
// All agents queue through a single promise chain. Structured output via
// Ollama's `format` parameter forces schema-valid tool calls by construction.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
}
