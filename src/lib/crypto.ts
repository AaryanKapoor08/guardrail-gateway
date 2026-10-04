import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const CIPHER = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Additional authenticated data ties a ciphertext to its owner and column, so an encrypted
// token copied into another user's row (or another column) fails to decrypt.
export function aadFor(userId: string, field: string): string {
  return `${userId}|${field}`;
}

// Format: `v1:<base64 iv>:<base64 ciphertext>:<base64 auth tag>`. The version prefix lets us
// rotate the algorithm or key later without guessing how old values were written.
export function encryptField(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv, ciphertext, authTag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
}

function parseEncryptedBlob(blob: string): { iv: Buffer; ciphertext: Buffer; authTag: Buffer } {
  const [version, iv, ciphertext, authTag, ...rest] = blob.split(':');
  if (version !== VERSION || rest.length > 0) {
    throw new Error('[Crypto] unknown encrypted value format');
  }
  if (iv === undefined || ciphertext === undefined || authTag === undefined) {
    throw new Error('[Crypto] malformed encrypted value');
  }
  return {
    iv: Buffer.from(iv, 'base64'),
    ciphertext: Buffer.from(ciphertext, 'base64'),
    authTag: Buffer.from(authTag, 'base64'),
  };
}

export function decryptField(blob: string, key: Buffer, aad: string): string {
  const { iv, ciphertext, authTag } = parseEncryptedBlob(blob);
  // A short tag would weaken the integrity check, so only full-length tags are accepted.
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('[Crypto] malformed encrypted value');
  }
  try {
    const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    throw new Error('[Crypto] decryption failed (wrong key, wrong owner, or tampered value)', {
      cause: error,
    });
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// Constant-time comparison so an attacker can't learn a secret one character at a time from
// response timing. Different lengths can't be equal and timingSafeEqual requires equal lengths.
export function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, 'utf8');
  const bBytes = Buffer.from(b, 'utf8');
  if (aBytes.length !== bBytes.length) {
    return false;
  }
  return timingSafeEqual(aBytes, bBytes);
}

// PKCE S256 (RFC 7636): the challenge is base64url(SHA-256(verifier)).
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}
