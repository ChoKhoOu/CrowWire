import { invokeTool } from '../lib/invoke.js';
import { splitMarkdownMessages } from '../lib/formatter.js';
import { readStdin } from './shared.js';

async function sendMessage(channel: string, target: string, text: string): Promise<void> {
  await invokeTool({
    tool: 'message',
    action: 'send',
    args: { channel, target },
    input: text,
  });
}

export async function runSend(channel: string, target: string): Promise<void> {
  if (!target) {
    throw new Error('--target is required (e.g. --target channel:123456)');
  }

  const input = await readStdin();
  if (!input.trim()) return;

  const messages = splitMarkdownMessages(input);

  for (const msg of messages) {
    if (!msg.trim()) continue;
    await sendMessage(channel, target, msg);
  }
}
