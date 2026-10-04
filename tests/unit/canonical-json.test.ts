import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/webhooks/canonical-json.js';
import { signatureFor } from '../../src/webhooks/verify.js';

// Every expected string below was produced once by Python 3.13:
//   json.dumps(obj, sort_keys=True, separators=(',', ':'))
// and pasted here, so these tests check byte-for-byte agreement with SnapTrade's signer.

describe('canonicalJson (Python json.dumps compatible)', () => {
  it('sorts keys at every level and uses compact separators', () => {
    const value = { b: { z: 1, a: [3, { y: 'x', c: null }] }, a: true, C: false };

    expect(canonicalJson(value)).toBe(
      '{"C":false,"a":true,"b":{"a":[3,{"c":null,"y":"x"}],"z":1}}',
    );
  });

  it('escapes non-ASCII as \\uXXXX, emoji as a surrogate pair', () => {
    const value = { name: 'café', emoji: 'rocket 🚀', cjk: '株式' };

    expect(canonicalJson(value)).toBe(
      '{"cjk":"\\u682a\\u5f0f","emoji":"rocket \\ud83d\\ude80","name":"caf\\u00e9"}',
    );
  });

  it('escapes quotes, backslashes, and control characters the way Python does', () => {
    const value = { s: 'quote" back\\ nl\n cr\r tab\t bs\b ff\f nul\u0000 us\u001f del\u007f' };

    expect(canonicalJson(value)).toBe(
      '{"s":"quote\\" back\\\\ nl\\n cr\\r tab\\t bs\\b ff\\f nul\\u0000 us\\u001f del\\u007f"}',
    );
  });

  it('writes integers plainly', () => {
    const value = { int: 42, neg: -7, big: 12345678901234, zero: 0 };

    expect(canonicalJson(value)).toBe('{"big":12345678901234,"int":42,"neg":-7,"zero":0}');
  });

  it('writes empty objects, arrays, and strings', () => {
    expect(canonicalJson({ o: {}, l: [], s: '' })).toBe('{"l":[],"o":{},"s":""}');
  });

  it('refuses values JSON cannot represent', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow('[Webhooks]');
  });

  it('produces the same HMAC as Python for a webhook with a non-ASCII detail', () => {
    const payload = {
      schemaVersion: 'oauth_v1',
      webhookId: '6f1c2b9e-1d3a-4c5b-8e7f-9a0b1c2d3e4f',
      oauthClientId: 'test-client-id',
      eventTimestamp: '2026-10-05T13:59:00Z',
      userId: 'snaptrade-user-1',
      eventType: 'CONNECTION_BROKEN',
      connectionId: '87b24961-b51e-4db8-9226-f198f6518a89',
      brokerageId: 'b1',
      accountId: null,
      details: { reason: 'Expired credentials — reconnect' },
    };

    expect(signatureFor(payload, 'test-consumer-key-value')).toBe(
      'Vx5ef1E7zwz+CYF+aw0hr0Ma+/YM3AvXxvLrVufQcTE=',
    );
  });
});
