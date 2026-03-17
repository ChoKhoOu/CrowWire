import { execSync } from 'node:child_process';
import { splitMarkdownMessages } from '../lib/formatter.js';
import { readStdin } from './shared.js';

function detectSendMethod(): 'openclaw.invoke' | 'openclaw' {
  try {
    execSync('command -v openclaw.invoke', { stdio: 'pipe' });
    return 'openclaw.invoke';
  } catch {
    // openclaw.invoke shim not available, fall back to openclaw CLI
    return 'openclaw';
  }
}

function sendMessage(method: 'openclaw.invoke' | 'openclaw', channel: string, text: string): void {
  if (method === 'openclaw.invoke') {
    const argsJson = JSON.stringify({ channel });
    execSync(
      `openclaw.invoke --tool message --action send --args-json '${argsJson.replace(/'/g, "'\\''")}'`,
      { input: text, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } else {
    execSync(
      `openclaw message send --channel ${channel}`,
      { input: text, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
}

export async function runSend(channel: string): Promise<void> {
  const input = await readStdin();
  if (!input.trim()) return;

  const messages = splitMarkdownMessages(input);
  const method = detectSendMethod();

  for (const msg of messages) {
    if (!msg.trim()) continue;
    sendMessage(method, channel, msg);
  }
}
