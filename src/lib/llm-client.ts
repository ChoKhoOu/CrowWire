// Direct OpenAI-compatible API client for CrowWire v2
// Replaces the invokeTool('llm-task', ...) pattern

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_RETRIES = 2
const RETRY_DELAYS = [1000, 3000] // exponential backoff

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
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
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }

    if (options?.temperature !== undefined) body.temperature = options.temperature
    if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options?.responseFormat !== undefined) body.response_format = options.responseFormat

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

        const data = (await res.json()) as ChatCompletionResponse
        const content = data.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
          throw new Error('Invalid response: missing choices[0].message.content')
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
