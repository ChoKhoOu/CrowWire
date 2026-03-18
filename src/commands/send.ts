import { execSync } from 'node:child_process';
import { detectInvokeShim } from '../lib/invoke.js';
import { splitMarkdownMessages } from '../lib/formatter.js';
import { readStdin } from './shared.js';

function sendMessage(channel: string, target: string, text: string): void {
  const shim = detectInvokeShim();
  if (shim) {
    const argsJson = JSON.stringify({ channel, target });
    execSync(
      `${shim} --tool message --action send --args-json '${argsJson.replace(/'/g, "'\\''")}'`,
      { input: text, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  } else {
    const escaped = text.replace(/'/g, "'\\''");
    execSync(
      `openclaw message send --channel ${channel} --target ${target} --message '${escaped}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
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
    sendMessage(channel, target, msg);
  }
}
