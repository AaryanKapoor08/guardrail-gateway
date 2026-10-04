import { createHmac } from 'node:crypto';
import { safeEqual } from '../lib/crypto.js';
import { canonicalJson } from './canonical-json.js';

// SnapTrade's webhook signature (V§5.5): base64 HMAC-SHA256 of the canonical JSON, keyed with
// our consumer key. Checked before any field of the payload is trusted.

export function signatureFor(payload: unknown, consumerKey: string): string {
  return createHmac('sha256', consumerKey).update(canonicalJson(payload), 'utf8').digest('base64');
}

// False for a missing header, a body that isn't JSON, or a signature that doesn't match.
export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  consumerKey: string,
): boolean {
  if (signatureHeader === undefined || signatureHeader === '') {
    return false;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Handled: a body that isn't JSON can't carry a valid signature.
    return false;
  }
  return safeEqual(signatureFor(payload, consumerKey), signatureHeader.trim());
}
