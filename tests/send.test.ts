import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/invoke.js', () => ({
  invokeTool: vi.fn().mockResolvedValue({ output: '', transport: 'http' }),
  detectInvokeShim: vi.fn(),
  getInvokeShim: vi.fn(),
  _resetCache: vi.fn(),
}));

const { invokeTool } = await import('../src/lib/invoke.js');
const mockedInvokeTool = vi.mocked(invokeTool);

const { runSend } = await import('../src/commands/send.js');

// Helper to mock stdin
function mockStdin(content: string) {
  const original = process.stdin;
  const chunks = [Buffer.from(content)];
  let dataHandler: ((chunk: Buffer) => void) | null = null;
  let endHandler: (() => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = Object.create(original);
  fake.on = function (event: string, handler: (...args: unknown[]) => void) {
    if (event === 'data') {
      dataHandler = handler as (chunk: Buffer) => void;
    } else if (event === 'end') {
      endHandler = handler as () => void;
    }
    if (dataHandler && endHandler) {
      queueMicrotask(() => {
        for (const c of chunks) dataHandler!(c);
        endHandler!();
      });
    }
    return this;
  };

  vi.spyOn(process, 'stdin', 'get').mockReturnValue(fake);
}

describe('send command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls invokeTool with correct tool/action/args', async () => {
    mockStdin('Test message');
    await runSend('discord', 'channel:123456');

    expect(mockedInvokeTool).toHaveBeenCalledWith({
      tool: 'message',
      action: 'send',
      args: { channel: 'discord', target: 'channel:123456' },
      input: 'Test message',
    });
  });

  it('passes channel and target correctly for telegram', async () => {
    mockStdin('Hello world');
    await runSend('telegram', 'chat:789');

    expect(mockedInvokeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { channel: 'telegram', target: 'chat:789' },
        input: 'Hello world',
      }),
    );
  });

  it('does nothing on empty input', async () => {
    mockStdin('   ');
    await runSend('discord', 'channel:123456');

    expect(mockedInvokeTool).not.toHaveBeenCalled();
  });

  it('throws when target is missing', async () => {
    await expect(runSend('discord', '')).rejects.toThrow('--target is required');
  });

  it('does not send empty string messages after split', async () => {
    mockStdin('');
    await runSend('discord', 'channel:123456');

    expect(mockedInvokeTool).not.toHaveBeenCalled();
  });

  it('splits long messages and sends each part', async () => {
    const longMsg = 'A'.repeat(2000) + '\n\n' + 'B'.repeat(100);
    mockStdin(longMsg);
    await runSend('discord', 'channel:123456');

    expect(mockedInvokeTool).toHaveBeenCalledTimes(2);
    for (const call of mockedInvokeTool.mock.calls) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opts = call[0] as any;
      expect(opts.args.channel).toBe('discord');
      expect(opts.args.target).toBe('channel:123456');
    }
  });

  it('message text is passed via input field, not args', async () => {
    mockStdin('Hello world');
    await runSend('slack', 'channel:abc');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = mockedInvokeTool.mock.calls[0][0] as any;
    expect(opts.input).toBe('Hello world');
    expect(opts.args).not.toHaveProperty('message');
  });
});
