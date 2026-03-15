import { createHash } from 'crypto';
import type { CrowWireEvent } from '../../types/event.js';

export function computeContentHash(event: CrowWireEvent): string {
  const input = `${event.title}\n${event.summary}\n${event.content || ''}`;
  return createHash('sha256').update(input).digest('hex');
}
