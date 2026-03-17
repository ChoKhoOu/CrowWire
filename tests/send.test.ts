import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockedExecSync = vi.mocked(execSync);

// Re-import after mock
const { runSend } = await import('../src/commands/send.js');

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
  });

  it('passes channel and target to openclaw.invoke when available', async () => {
    // First call: command -v openclaw.invoke -> success
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v')) return Buffer.from('/usr/bin/openclaw.invoke');
      return Buffer.from('');
    });

    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    // Second call should be openclaw.invoke with both channel and target
    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('openclaw.invoke --tool message'),
    );
    expect(sendCall).toBeDefined();
    const cmdStr = sendCall![0] as string;
    expect(cmdStr).toContain('"channel":"discord"');
    expect(cmdStr).toContain('"target":"channel:123456"');
  });

  it('falls back to openclaw CLI with --channel and --target', async () => {
    // command -v openclaw.invoke -> fails
    mockedExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('command -v')) throw new Error('not found');
      return Buffer.from('');
    });

    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    const sendCall = mockedExecSync.mock.calls.find(
      c => typeof c === 'string' ? false : (typeof c[0] === 'string' && c[0].includes('openclaw message send')),
    );
    expect(sendCall).toBeDefined();
    const cmdStr = sendCall![0] as string;
    expect(cmdStr).toContain('--channel discord');
    expect(cmdStr).toContain('--target channel:123456');
  });

  it('does nothing on empty input', async () => {
    mockStdin('   ');
    await runSend('discord', 'channel:123456');

    // Should not call any send commands (only possibly command -v)
    const sendCalls = mockedExecSync.mock.calls.filter(
      c => typeof c[0] === 'string' && (c[0].includes('openclaw.invoke --tool') || c[0].includes('openclaw message send')),
    );
    expect(sendCalls).toHaveLength(0);
  });
});
