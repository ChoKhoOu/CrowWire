import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordRestTarget, createPushTargets, getTargetsForQueue } from '../src/lib/push-target.js'
import type { TargetsConfig } from '../src/types.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeOkResponse(overrides?: Partial<Response>): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(''),
    ...overrides,
  } as unknown as Response
}

function makeErrorResponse(status: number, body = 'error', headers?: Record<string, string>): Response {
  return {
    ok: false,
    status,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    text: () => Promise.resolve(body),
  } as unknown as Response
}

describe('DiscordRestTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('sends a single message with correct URL, headers, and body', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse())

    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['urgent'])
    await target.send('Hello Discord')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/channels/channel-123/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bot bot-token-abc',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ content: 'Hello Discord' }),
      }),
    )
  })

  it('splits long messages and sends multiple fetch calls', async () => {
    // Two chunks: each slightly under 1900 chars separated by paragraph boundary
    const chunk1 = 'A'.repeat(1800)
    const chunk2 = 'B'.repeat(100)
    const text = `${chunk1}\n\n${chunk2}`

    mockFetch.mockResolvedValue(makeOkResponse())

    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['normal'])
    await target.send(text)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const body1 = JSON.parse(mockFetch.mock.calls[0][1].body)
    const body2 = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body1.content).toBe(chunk1)
    expect(body2.content).toBe(chunk2)
  })

  it('handles 429 rate limit by waiting Retry-After then retrying', async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(429, 'rate limited', { 'Retry-After': '2' }))
      .mockResolvedValueOnce(makeOkResponse())

    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['urgent'])

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const sendPromise = target.send('Hello')
    // Advance past the 2000ms rate limit wait
    await vi.advanceTimersByTimeAsync(2000)
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Rate limited'))
    stderrSpy.mockRestore()
  })

  it('retries on server error (500) then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(500))
      .mockResolvedValueOnce(makeOkResponse())

    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['normal'])

    const sendPromise = target.send('Hello')
    // Advance past the 1000ms retry wait (attempt 0 => 1000ms)
    await vi.advanceTimersByTimeAsync(1000)
    await sendPromise

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('throws after max retries on persistent 500 errors', async () => {
    // 4 calls: attempt 0, 1, 2, 3 (retries=3)
    mockFetch.mockResolvedValue(makeErrorResponse(500, 'internal server error'))

    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['urgent'])

    // Advance timers concurrently with the send promise to avoid unhandled rejection
    const [result] = await Promise.allSettled([
      target.send('Hello'),
      vi.advanceTimersByTimeAsync(6000),
    ])

    expect(result.status).toBe('rejected')
    expect((result as PromiseRejectedResult).reason.message).toContain('Discord API error 500: internal server error')
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('skips empty chunks and does not send them', async () => {
    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['normal'])
    // Empty string produces no chunks from splitMarkdownMessages
    await target.send('')

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('destroy resolves without error and is a no-op', async () => {
    const target = new DiscordRestTarget('test', 'channel-123', 'bot-token-abc', ['urgent'])
    await expect(target.destroy()).resolves.toBeUndefined()
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('createPushTargets', () => {
  it('creates correct DiscordRestTarget instances from config', () => {
    const config: TargetsConfig = {
      targets: [
        { name: 'alerts', type: 'discord', channel_id: 'ch-1', queues: ['urgent'] },
        { name: 'digest', type: 'discord', channel_id: 'ch-2', queues: ['normal'] },
      ],
    }

    const targets = createPushTargets(config, 'my-bot-token')

    expect(targets).toHaveLength(2)
    expect(targets[0]).toBeInstanceOf(DiscordRestTarget)
    expect(targets[0].name).toBe('alerts')
    expect(targets[0].type).toBe('discord')
    expect(targets[0].queues).toEqual(['urgent'])
    expect(targets[1]).toBeInstanceOf(DiscordRestTarget)
    expect(targets[1].name).toBe('digest')
    expect(targets[1].queues).toEqual(['normal'])
  })

  it('throws on unsupported push target type', () => {
    const config = {
      targets: [
        { name: 'tg', type: 'telegram', channel_id: 'chat-1', queues: ['urgent'] },
      ],
    } as unknown as TargetsConfig

    expect(() => createPushTargets(config, 'token')).toThrow('Unsupported push target type: telegram')
  })
})

describe('getTargetsForQueue', () => {
  it('filters targets by queue type correctly', () => {
    const config: TargetsConfig = {
      targets: [
        { name: 'urgent-ch', type: 'discord', channel_id: 'ch-u', queues: ['urgent'] },
        { name: 'normal-ch', type: 'discord', channel_id: 'ch-n', queues: ['normal'] },
        { name: 'both-ch', type: 'discord', channel_id: 'ch-b', queues: ['urgent', 'normal'] },
      ],
    }
    const targets = createPushTargets(config, 'token')

    const urgentTargets = getTargetsForQueue(targets, 'urgent')
    expect(urgentTargets).toHaveLength(2)
    expect(urgentTargets.map(t => t.name)).toEqual(['urgent-ch', 'both-ch'])

    const normalTargets = getTargetsForQueue(targets, 'normal')
    expect(normalTargets).toHaveLength(2)
    expect(normalTargets.map(t => t.name)).toEqual(['normal-ch', 'both-ch'])
  })
})
