import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execSync, execFileSync } from 'node:child_process';

const mockedExecSync = vi.mocked(execSync);
const mockedExecFileSync = vi.mocked(execFileSync);

const { invokeTool } = await import('../src/lib/invoke.js');

describe('invokeTool', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ['CLAWD_URL', 'CLAWD_TOKEN', 'OPENCLAW_GATEWAY_PORT', 'OPENCLAW_GATEWAY_TOKEN'];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('uses HTTP transport when CLAWD_URL is set', async () => {
    process.env.CLAWD_URL = 'http://localhost:3000';
    process.env.CLAWD_TOKEN = 'test-token';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('{"result":"ok"}'),
    });

    const result = await invokeTool({
      tool: 'llm-task',
      action: 'json',
      args: { prompt: 'test' },
    });

    expect(result.transport).toBe('http');
    expect(result.output).toBe('{"result":"ok"}');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/tools/invoke',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
        }),
      }),
    );
  });

  it('uses HTTP with OPENCLAW_GATEWAY_PORT', async () => {
    process.env.OPENCLAW_GATEWAY_PORT = '4000';
    process.env.OPENCLAW_GATEWAY_TOKEN = 'gw-token';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('ok'),
    });

    const result = await invokeTool({
      tool: 'message',
      action: 'send',
      args: { channel: 'discord' },
      input: 'hello',
    });

    expect(result.transport).toBe('http');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/tools/invoke',
      expect.objectContaining({
        body: expect.stringContaining('"input":"hello"'),
      }),
    );
  });

  it('CLAWD_URL takes priority over OPENCLAW_GATEWAY_PORT', async () => {
    process.env.CLAWD_URL = 'http://primary:3000';
    process.env.CLAWD_TOKEN = 'primary-token';
    process.env.OPENCLAW_GATEWAY_PORT = '4000';
    process.env.OPENCLAW_GATEWAY_TOKEN = 'gw-token';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('ok'),
    });

    await invokeTool({ tool: 'test', action: 'test', args: {} });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://primary:3000/tools/invoke',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer primary-token',
        }),
      }),
    );
  });

  it('falls back to binary when HTTP unavailable', async () => {
    mockedExecSync.mockImplementation(((cmd: string) => {
      if (cmd === 'command -v clawd.invoke') return Buffer.from('/usr/bin/clawd.invoke');
      throw new Error('unexpected: ' + cmd);
    }) as typeof execSync);

    mockedExecFileSync.mockReturnValueOnce('{"output":"from-binary"}' as never);

    const result = await invokeTool({
      tool: 'llm-task',
      action: 'json',
      args: { prompt: 'test' },
    });

    expect(result.transport).toBe('binary');
    expect(result.output).toBe('{"output":"from-binary"}');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'clawd.invoke',
      ['--tool', 'llm-task', '--action', 'json', '--args-json', '{"prompt":"test"}'],
      expect.any(Object),
    );
  });

  it('falls back to lobster when HTTP and binary unavailable', async () => {
    mockedExecSync.mockImplementation(((cmd: string) => {
      if (cmd === 'command -v clawd.invoke') throw new Error('not found');
      if (cmd === 'command -v openclaw.invoke') throw new Error('not found');
      if (cmd === 'command -v lobster') return Buffer.from('/usr/bin/lobster');
      throw new Error('unexpected: ' + cmd);
    }) as typeof execSync);

    mockedExecFileSync.mockReturnValueOnce('{"output":"from-lobster"}' as never);

    const result = await invokeTool({
      tool: 'llm-task',
      action: 'json',
      args: { prompt: 'test' },
    });

    expect(result.transport).toBe('lobster');
    expect(result.output).toBe('{"output":"from-lobster"}');
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'lobster',
      [expect.stringContaining('clawd.invoke')],
      expect.any(Object),
    );
  });

  it('lobster transport includes HTTP config in inner command', async () => {
    process.env.OPENCLAW_GATEWAY_PORT = '5000';
    process.env.OPENCLAW_GATEWAY_TOKEN = 'tok';

    // HTTP fails
    mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('err'), status: 500, statusText: 'Error' });

    // Binary not available
    mockedExecSync.mockImplementation(((cmd: string) => {
      if (cmd === 'command -v clawd.invoke') throw new Error('not found');
      if (cmd === 'command -v openclaw.invoke') throw new Error('not found');
      if (cmd === 'command -v lobster') return Buffer.from('/usr/bin/lobster');
      throw new Error('unexpected: ' + cmd);
    }) as typeof execSync);

    mockedExecFileSync.mockReturnValueOnce('ok' as never);

    await invokeTool({ tool: 'llm-task', action: 'json', args: {} });

    const lobsterArgs = mockedExecFileSync.mock.calls[0][1] as string[];
    expect(lobsterArgs[0]).toContain('--url http://127.0.0.1:5000');
    expect(lobsterArgs[0]).toContain('--token tok');
  });

  it('throws when all transports fail', async () => {
    mockedExecSync.mockImplementation((() => {
      throw new Error('not found');
    }) as typeof execSync);

    await expect(invokeTool({
      tool: 'llm-task',
      action: 'json',
      args: {},
    })).rejects.toThrow('[invoke] All transports failed');
  });

  it('passes input/stdin through HTTP body', async () => {
    process.env.CLAWD_URL = 'http://localhost:3000';
    process.env.CLAWD_TOKEN = 'tok';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('sent'),
    });

    await invokeTool({
      tool: 'message',
      action: 'send',
      args: { channel: 'discord', target: 'channel:123' },
      input: 'Hello world',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input).toBe('Hello world');
    expect(body.args.channel).toBe('discord');
  });

  it('passes input via execFileSync input option for binary', async () => {
    mockedExecSync.mockImplementation(((cmd: string) => {
      if (cmd === 'command -v clawd.invoke') return Buffer.from('/usr/bin/clawd.invoke');
      throw new Error('unexpected');
    }) as typeof execSync);

    mockedExecFileSync.mockReturnValueOnce('ok' as never);

    await invokeTool({
      tool: 'message',
      action: 'send',
      args: { channel: 'discord' },
      input: 'Test msg',
    });

    const opts = mockedExecFileSync.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.input).toBe('Test msg');
  });

  it('handles HTTP non-ok response and falls through', async () => {
    process.env.CLAWD_URL = 'http://localhost:3000';
    process.env.CLAWD_TOKEN = 'tok';

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('server error'),
    });

    // Binary available as fallback
    mockedExecSync.mockImplementation(((cmd: string) => {
      if (cmd === 'command -v clawd.invoke') return Buffer.from('/usr/bin/clawd.invoke');
      throw new Error('unexpected');
    }) as typeof execSync);

    mockedExecFileSync.mockReturnValueOnce('fallback-result' as never);

    const result = await invokeTool({ tool: 'test', action: 'test', args: {} });
    expect(result.transport).toBe('binary');
  });
});
