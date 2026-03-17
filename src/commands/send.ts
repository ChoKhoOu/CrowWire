import { execSync } from 'node:child_process';
import { splitMarkdownMessages } from '../lib/formatter.js';
import { readStdin } from './shared.js';

export async function runSend(channel: string): Promise<void> {
  const input = await readStdin();
  if (!input.trim()) return;

  const messages = splitMarkdownMessages(input);

  for (const msg of messages) {
    if (!msg.trim()) continue;
    const argsJson = JSON.stringify({ channel });
    execSync(
      `openclaw.invoke --tool message --action send --args-json '${argsJson.replace(/'/g, "'\\''")}'`,
      { input: msg, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  }
}
