import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const { LlmClient, createLlmClient } = await import('../src/lib/llm-client.js')

function makeOkResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      choices: [{ message: { content } }],
    }),
    text: () => Promise.resolve(content),
  }
}

function makeErrorResponse(status: number, body = 'error') {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  }
}

describe('LlmClient', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL']

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
    vi.useRealTimers()
  })

  // 1. Successful chat completion
  it('sends correct API request and returns content', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeOkResponse('Hello world'))

    const result = await client.chatCompletion('You are helpful.', 'Say hi')

    expect(result).toBe('Hello world')
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/chat/completions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-4')
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Say hi' },
    ])
  })

  // 2. Retry on network failure then succeeds
  it('retries on network failure and eventually succeeds', async () => {
    vi.useFakeTimers()
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    mockFetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeOkResponse('success'))

    const promise = client.chatCompletion('sys', 'user')
    // Advance timers for retry delays (1000ms + 3000ms)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result).toBe('success')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  // 3. Timeout via AbortController
  it('throws on timeout', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4', 50)

    // fetch rejects when signal is aborted
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined
        if (signal?.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
          return
        }
        signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    await expect(client.chatCompletion('sys', 'user')).rejects.toThrow('timed out')
  })

  // 4. JSON completion parses result
  it('chatCompletionJson parses JSON response', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeOkResponse('{"score":42}'))

    const result = await client.chatCompletionJson<{ score: number }>('sys', 'user')

    expect(result).toEqual({ score: 42 })
    // Should include response_format in request body
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  // 5. JSON parse error throws
  it('chatCompletionJson throws on non-JSON response', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeOkResponse('not valid json }{'))

    await expect(
      client.chatCompletionJson('sys', 'user'),
    ).rejects.toThrow('JSON parse failed')
  })

  // 6. Non-200 response retries then succeeds
  it('retries on non-200 response', async () => {
    vi.useFakeTimers()
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(429, 'rate limited'))
      .mockResolvedValueOnce(makeErrorResponse(500, 'server error'))
      .mockResolvedValueOnce(makeOkResponse('ok after retries'))

    const promise = client.chatCompletion('sys', 'user')
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(3000)
    const result = await promise

    expect(result).toBe('ok after retries')
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  // 7. All retries exhausted throws
  it('throws after all retries exhausted', async () => {
    vi.useFakeTimers()
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    mockFetch.mockImplementation(() => new Promise((_, reject) =>
      queueMicrotask(() => reject(new Error('persistent failure'))),
    ))

    const promise = client.chatCompletion('sys', 'user')

    // Advance timers concurrently while awaiting the rejection
    const [result] = await Promise.all([
      expect(promise).rejects.toThrow('persistent failure'),
      vi.advanceTimersByTimeAsync(1000).then(() => vi.advanceTimersByTimeAsync(3000)),
    ])

    void result
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  // 8. createLlmClient reads env vars
  it('createLlmClient creates client from env vars', async () => {
    process.env.LLM_BASE_URL = 'https://my-llm.example.com'
    process.env.LLM_API_KEY = 'my-key'
    process.env.LLM_MODEL = 'my-model'

    mockFetch.mockResolvedValueOnce(makeOkResponse('env test'))

    const client = createLlmClient()
    const result = await client.chatCompletion('sys', 'user')

    expect(result).toBe('env test')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://my-llm.example.com/chat/completions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer my-key')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('my-model')
  })

  // 9. createLlmClient throws on missing env
  it('createLlmClient throws when env vars are missing', () => {
    // All env vars already deleted in beforeEach
    expect(() => createLlmClient()).toThrow('Missing required env vars: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL')
  })

  // trailing-slash normalization
  it('strips trailing slash from baseUrl', async () => {
    const client = new LlmClient('https://api.example.com/', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeOkResponse('ok'))

    await client.chatCompletion('sys', 'user')

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('https://api.example.com/chat/completions')
  })

  // === chatCompletionStream tests ===

  function makeStreamResponse(chunks: string[]) {
    const sseLines = chunks.map(c =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
    ).join('') + 'data: [DONE]\n\n'

    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseLines))
          controller.close()
        },
      }),
    }
  }

  it('chatCompletionStream calls onChunk with text content', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeStreamResponse(['Hello', ' world']))

    const chunks: string[] = []
    await client.chatCompletionStream('sys', 'user', (text) => chunks.push(text))

    expect(chunks).toEqual(['Hello', ' world'])
    // Verify stream: true in request
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body.stream).toBe(true)
    expect(body.response_format).toBeUndefined()
  })

  it('chatCompletionStream handles data: [DONE] sentinel', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')
    mockFetch.mockResolvedValueOnce(makeStreamResponse(['ok']))

    const chunks: string[] = []
    await client.chatCompletionStream('sys', 'user', (text) => chunks.push(text))

    expect(chunks).toEqual(['ok'])
  })

  it('chatCompletionStream retries on initial connection failure', async () => {
    vi.useFakeTimers()
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    mockFetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(makeStreamResponse(['retry-ok']))

    const chunks: string[] = []
    const promise = client.chatCompletionStream('sys', 'user', (text) => chunks.push(text))
    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(chunks).toEqual(['retry-ok'])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('chatCompletionStream throws on timeout', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    // Create a stream that hangs — reader.read() blocks until abort signal fires
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined
      return Promise.resolve({
        ok: true,
        status: 200,
        body: new ReadableStream({
          pull() {
            return new Promise((_resolve, reject) => {
              if (signal?.aborted) {
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                reject(err)
                return
              }
              signal?.addEventListener('abort', () => {
                const err = new Error('The operation was aborted')
                err.name = 'AbortError'
                reject(err)
              })
            })
          },
        }),
      })
    })

    await expect(
      client.chatCompletionStream('sys', 'user', () => {}, { timeoutMs: 50 })
    ).rejects.toThrow('timed out')
  })

  it('chatCompletionStream resolves with partial results on mid-stream error', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    let readerCallCount = 0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        pull(controller) {
          readerCallCount++
          if (readerCallCount === 1) {
            const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}\n\n`
            controller.enqueue(new TextEncoder().encode(chunk))
          } else {
            controller.error(new Error('stream broke'))
          }
        },
      }),
    })

    const chunks: string[] = []
    // Should resolve (not throw) — partial results kept
    await client.chatCompletionStream('sys', 'user', (text) => chunks.push(text))

    expect(chunks).toEqual(['partial'])
  })

  it('chatCompletionStream handles SSE line split across chunks', async () => {
    const client = new LlmClient('https://api.example.com', 'sk-test', 'gpt-4')

    // Split a single SSE line across two chunks
    const fullLine = `data: ${JSON.stringify({ choices: [{ delta: { content: 'split-test' } }] })}\n\ndata: [DONE]\n\n`
    const splitPoint = 5 // Split after "data:"
    const part1 = fullLine.slice(0, splitPoint)
    const part2 = fullLine.slice(splitPoint)

    let readCount = 0
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        pull(controller) {
          readCount++
          if (readCount === 1) {
            controller.enqueue(new TextEncoder().encode(part1))
          } else if (readCount === 2) {
            controller.enqueue(new TextEncoder().encode(part2))
          } else {
            controller.close()
          }
        },
      }),
    })

    const chunks: string[] = []
    await client.chatCompletionStream('sys', 'user', (text) => chunks.push(text))

    expect(chunks).toEqual(['split-test'])
  })
})
