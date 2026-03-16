import { formatUrgent, formatDigest, formatDigestGrouped } from '../lib/formatter.js';
import type { ClassifyOutput } from '../types.js';
import { readStdin } from './shared.js';

export async function runFormat(type: 'urgent' | 'digest'): Promise<void> {
  const input = await readStdin();
  if (!input.trim()) return;

  const data: ClassifyOutput = JSON.parse(input);

  let output: string;
  if (type === 'urgent') {
    output = formatUrgent(data.urgent);
  } else if (data.digestGroups && data.digestGroups.length > 0) {
    output = formatDigestGrouped(data.digestGroups);
  } else {
    output = formatDigest(data.digest);
  }

  if (output) {
    process.stdout.write(output);
  }
}
