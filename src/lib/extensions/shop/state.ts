// ============================================================
// Shop connector — OAuth CSRF state (SGC & IdeasLab fork).
//
// Provider-agnostic. The value is minted here, stored in the OAuth cookie, and
// compared to the `state` the provider echoes back on the callback.
// ============================================================

import crypto from 'crypto';

/** Opaque, unguessable CSRF `state` token (128 bits, hex). */
export function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}
