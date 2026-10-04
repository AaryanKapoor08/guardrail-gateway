import { describe, expect, it } from 'vitest';
import {
  aadFor,
  decryptField,
  encryptField,
  pkceChallenge,
  randomToken,
  safeEqual,
  sha256Hex,
} from '../../src/lib/crypto.js';

const KEY = Buffer.alloc(32, 1);
const OTHER_KEY = Buffer.alloc(32, 2);
const AAD = aadFor('2f1c7e8a-0000-4000-8000-000000000001', 'access_token');

// Replaces one base64 part of `v1:iv:ciphertext:tag` with a copy that has its first byte flipped.
function tamperPart(blob: string, partIndex: number): string {
  const parts = blob.split(':');
  const bytes = Buffer.from(parts[partIndex] ?? '', 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  parts[partIndex] = bytes.toString('base64');
  return parts.join(':');
}

describe('encryptField / decryptField', () => {
  it('round-trips a value', () => {
    const blob = encryptField('a-snaptrade-access-token', KEY, AAD);

    expect(decryptField(blob, KEY, AAD)).toBe('a-snaptrade-access-token');
  });

  it('writes the versioned v1 format', () => {
    const blob = encryptField('value', KEY, AAD);

    expect(blob).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it('produces different ciphertexts for the same text (random IV)', () => {
    const first = encryptField('same text', KEY, AAD);
    const second = encryptField('same text', KEY, AAD);

    expect(first).not.toBe(second);
  });

  it('throws when the ciphertext is tampered with', () => {
    const blob = tamperPart(encryptField('value', KEY, AAD), 2);

    expect(() => decryptField(blob, KEY, AAD)).toThrow('[Crypto] decryption failed');
  });

  it('throws when the auth tag is tampered with', () => {
    const blob = tamperPart(encryptField('value', KEY, AAD), 3);

    expect(() => decryptField(blob, KEY, AAD)).toThrow('[Crypto] decryption failed');
  });

  it('throws when the AAD is different (value moved to another user or column)', () => {
    const blob = encryptField('value', KEY, AAD);
    const otherAad = aadFor('2f1c7e8a-0000-4000-8000-000000000002', 'access_token');

    expect(() => decryptField(blob, KEY, otherAad)).toThrow('[Crypto] decryption failed');
  });

  it('throws with the wrong key', () => {
    const blob = encryptField('value', KEY, AAD);

    expect(() => decryptField(blob, OTHER_KEY, AAD)).toThrow('[Crypto] decryption failed');
  });

  it('rejects an unknown version prefix', () => {
    const blob = encryptField('value', KEY, AAD).replace(/^v1:/, 'v2:');

    expect(() => decryptField(blob, KEY, AAD)).toThrow('[Crypto] unknown encrypted value format');
  });

  it('rejects a truncated auth tag', () => {
    const parts = encryptField('value', KEY, AAD).split(':');
    parts[3] = Buffer.from(parts[3] ?? '', 'base64')
      .subarray(0, 4)
      .toString('base64');

    expect(() => decryptField(parts.join(':'), KEY, AAD)).toThrow('[Crypto] malformed');
  });
});

describe('aadFor', () => {
  it('joins the user id and field name', () => {
    expect(aadFor('user-1', 'refresh_token')).toBe('user-1|refresh_token');
  });
});

describe('sha256Hex', () => {
  it('matches the known SHA-256 of "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('randomToken', () => {
  it('returns 32 random bytes as base64url by default', () => {
    const token = randomToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });

  it('honours a custom byte length', () => {
    expect(Buffer.from(randomToken(16), 'base64url')).toHaveLength(16);
  });
});

describe('safeEqual', () => {
  it.each([
    ['equal strings', 'abc123', 'abc123', true],
    ['different strings of the same length', 'abc123', 'abc124', false],
    ['different lengths', 'abc', 'abcd', false],
    ['empty strings', '', '', true],
  ])('compares %s', (_label, a, b, expected) => {
    expect(safeEqual(a, b)).toBe(expected);
  });
});

describe('pkceChallenge', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
