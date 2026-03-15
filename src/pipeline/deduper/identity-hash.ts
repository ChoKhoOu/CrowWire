import { createHash } from 'crypto';
import type { CrowWireEvent } from '../../types/event.js';

export function computeIdentityHash(event: CrowWireEvent): string {
  const input = event.guid || event.canonical_url;
  return createHash('sha256').update(input).digest('hex');
}
