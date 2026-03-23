// OpenAI Responses API client for CrowWire v2
// Uses /v1/responses endpoint (replaces /v1/chat/completions)

const DEFAULT_TIMEOUT_MS = 60_000
const STREAM_TIMEOUT_MS = 180_000 // 3x default for streaming with larger batches
const MAX_RETRIES = 2
const RETRY_DELAYS = [1000, 3000] // exponential backoff

interface ResponsesApiResult {
  output: Array<{
    type: string
    content?: Array<{
      type: string
      text?: string
    }>
  }>
  status?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class LlmClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
    private timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async chatCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; responseFormat?: { type: string } },
  ): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userMessage,
    }

    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.maxTokens !== undefined) body.max_output_tokens = options.maxTokens
    if (options?.responseFormat !== undefined) body.text = { format: options.responseFormat }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1])
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        clearTimeout(timer)

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          const msg = `HTTP ${res.status}: ${errText.slice(0, 200)}`
          process.stderr.write(`[llm-client] Error: ${msg}\n`)
          lastError = new Error(msg)
          continue
        }

        const data = (await res.json()) as ResponsesApiResult
        const content = data.output
          ?.find(o => o.type === 'message')
          ?.content
          ?.find(c => c.type === 'output_text')
          ?.text
        if (typeof content !== 'string') {
          throw new Error('Invalid response: missing output_text in response')
        }
        return content
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === 'AbortError') {
          const msg = `Request timed out after ${this.timeoutMs}ms`
          process.stderr.write(`[llm-client] Error: ${msg}\n`)
          throw new Error(msg)
        }
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[llm-client] Error: ${msg}\n`)
        lastError = err instanceof Error ? err : new Error(msg)
      }
    }

    throw lastError ?? new Error('All retries exhausted')
  }

  async chatCompletionJson<T>(
    systemPrompt: string,
    userMessage: string,
  ): Promise<T> {
    const raw = await this.chatCompletion(systemPrompt, userMessage, {
      responseFormat: { type: 'json_object' },
    })

    try {
      return JSON.parse(raw) as T
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`[llm-client] JSON parse failed: ${msg}. Raw: ${raw.slice(0, 200)}`)
    }
  }

  async chatCompletionStream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number; timeoutMs?: number },
  ): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/responses`
    const timeoutMs = options?.timeoutMs ?? STREAM_TIMEOUT_MS

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userMessage,
      stream: true,
    }

    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.maxTokens !== undefined) body.max_output_tokens = options.maxTokens

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1])
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok) {
          clearTimeout(timer)
          const errText = await res.text().catch(() => '')
          const msg = `HTTP ${res.status}: ${errText.slice(0, 200)}`
          process.stderr.write(`[llm-client] Error: ${msg}\n`)
          lastError = new Error(msg)
          continue
        }

        // Connection succeeded — no more retries from here
        // Mid-stream errors resolve with partial results
        try {
          if (!res.body) {
            throw new Error('Response body is null — streaming not supported by server')
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          const MAX_LINE_LENGTH = 65_536
          let partialLine = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = partialLine + decoder.decode(value, { stream: true })
            const lines = text.split('\n')
            // Last element may be incomplete — save for next chunk
            partialLine = lines.pop() ?? ''

            if (partialLine.length > MAX_LINE_LENGTH) {
              partialLine = '' // discard oversized incomplete line
            }

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data: ')) continue
              try {
                const json = JSON.parse(trimmed.slice(6)) as {
                  type?: string
                  delta?: string
                }
                if (json.type === 'response.completed' || json.type === 'response.failed' || json.type === 'response.incomplete') {
                  clearTimeout(timer)
                  return
                }
                if (json.type === 'response.output_text.delta' && typeof json.delta === 'string' && json.delta) {
                  onChunk(json.delta)
                }
              } catch {
                // Malformed SSE JSON line — skip silently
              }
            }
          }

          // Process any remaining partial line
          if (partialLine.trim()) {
            const trimmed = partialLine.trim()
            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6)) as {
                  type?: string
                  delta?: string
                }
                if (json.type === 'response.output_text.delta' && typeof json.delta === 'string' && json.delta) {
                  onChunk(json.delta)
                }
              } catch { /* skip */ }
            }
          }
        } catch (streamErr) {
          // Timeout (AbortError) — re-throw so outer catch handles it
          if (streamErr instanceof Error && streamErr.name === 'AbortError') {
            throw streamErr
          }
          // Mid-stream error — resolve with partial results
          const msg = streamErr instanceof Error ? streamErr.message : String(streamErr)
          process.stderr.write(`[llm-client] Stream interrupted: ${msg}\n`)
        }

        clearTimeout(timer)
        return
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof Error && err.name === 'AbortError') {
          const msg = `Stream timed out after ${timeoutMs}ms`
          process.stderr.write(`[llm-client] Error: ${msg}\n`)
          throw new Error(msg)
        }
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(`[llm-client] Error: ${msg}\n`)
        lastError = err instanceof Error ? err : new Error(msg)
      }
    }

    throw lastError ?? new Error('All retries exhausted')
  }
}

export function createLlmClient(): LlmClient {
  const baseUrl = process.env.LLM_BASE_URL
  const apiKey = process.env.LLM_API_KEY
  const model = process.env.LLM_MODEL
  if (!baseUrl || !apiKey || !model) {
    throw new Error('Missing required env vars: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
  }
  return new LlmClient(baseUrl, apiKey, model)
}
