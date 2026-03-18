import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

// Re-import after mock
const { runSend } = await import('../src/commands/send.js');
const { _resetCache } = await import('../src/lib/invoke.js');

// Helper to mock stdin
function mockStdin(content: string) {
  const original = process.stdin;
  const chunks = [Buffer.from(content)];
  let dataHandler: ((chunk: Buffer) => void) | null = null;
  let endHandler: (() => void) | null = null;

  vi.spyOn(process, 'stdin', 'get').mockReturnValue({
    ...original,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === 'data') {
        dataHandler = handler as (chunk: Buffer) => void;
      } else if (event === 'end') {
        endHandler = handler as () => void;
      }
      // Trigger async
      if (dataHandler && endHandler) {
        queueMicrotask(() => {
          for (const c of chunks) dataHandler!(c);
          endHandler!();
        });
      }
      return this;
    },
  } as unknown as NodeJS.ReadStream);
}

describe('send command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCache();
  });

  it('uses clawd.invoke when available (lobster >= 2026.1.24)', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v clawd.invoke')) return Buffer.from('/usr/bin/clawd.invoke');
      return Buffer.from('');
    });

    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('clawd.invoke --tool message'),
    );
    expect(sendCall).toBeDefined();
    const cmdStr = sendCall![0] as string;
    expect(cmdStr).toContain('"channel":"discord"');
    expect(cmdStr).toContain('"target":"channel:123456"');
  });

  it('uses openclaw.invoke when clawd.invoke is missing', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v clawd.invoke')) throw new Error('not found');
      if (typeof cmd === 'string' && cmd.includes('command -v openclaw.invoke')) return Buffer.from('/usr/bin/openclaw.invoke');
      return Buffer.from('');
    });

    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('openclaw.invoke --tool message'),
    );
    expect(sendCall).toBeDefined();
  });

  it('falls back to openclaw CLI when no invoke shim exists', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v')) throw new Error('not found');
      return Buffer.from('');
    });

    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('openclaw message send'),
    );
    expect(sendCall).toBeDefined();
    const cmdStr = sendCall![0] as string;
    expect(cmdStr).toContain('--channel discord');
    expect(cmdStr).toContain('--target channel:123456');
  });

  it('does nothing on empty input', async () => {
    mockStdin('   ');
    await runSend('discord', 'channel:123456');

    const sendCalls = mockedExecSync.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0].includes('--tool message') || c[0].includes('openclaw message send')),
    );
    expect(sendCalls).toHaveLength(0);
  });

  it('invoke path passes message via stdin', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v clawd.invoke')) return Buffer.from('/usr/bin/clawd.invoke');
      return Buffer.from('');
    });

    mockStdin('Hello world');
    await runSend('telegram', 'chat:789');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('--tool message'),
    );
    expect(sendCall).toBeDefined();
    const opts = sendCall![1] as { input?: string };
    expect(opts.input).toBe('Hello world');
  });

  it('fallback path passes message via --message flag, not stdin', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v')) throw new Error('not found');
      return Buffer.from('');
    });

    mockStdin('Hello world');
    await runSend('slack', 'channel:abc');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('openclaw message send'),
    );
    expect(sendCall).toBeDefined();
    const cmdStr = sendCall![0] as string;
    expect(cmdStr).toContain("--message 'Hello world'");
    const opts = sendCall![1] as { input?: string };
    expect(opts.input).toBeUndefined();
  });

  it('throws when target is missing', async () => {
    await expect(runSend('discord', '')).rejects.toThrow('--target is required');
  });

  it('does not send empty string messages after split', async () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v')) throw new Error('not found');
      return Buffer.from('');
    });

    mockStdin('');
    await runSend('discord', 'channel:123456');

    const sendCalls = mockedExecSync.mock.calls.filter(
      c => typeof c[0] === 'string' && c[0].includes('openclaw message send'),
    );
    expect(sendCalls).toHaveLength(0);
  });
});
