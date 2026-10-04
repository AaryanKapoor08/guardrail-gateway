import { describe, expect, it } from 'vitest';
import { assertNoSecrets } from '../../src/audit/write.js';

describe('assertNoSecrets', () => {
  it('accepts ordinary audit details', () => {
    expect(() =>
      assertNoSecrets({ symbol: 'VFV', side: 'buy', rule: 'max_order_value', count: 2 }),
    ).not.toThrow();
  });

  it.each(['accessToken', 'refresh_token', 'clientSecret', 'code', 'password', 'Authorization'])(
    'refuses a %s key',
    (key) => {
      expect(() => assertNoSecrets({ [key]: 'x' })).toThrow(`details key "${key}"`);
    },
  );

  it('refuses a secret-looking key nested inside objects and arrays', () => {
    expect(() => assertNoSecrets({ checks: [{ rule: 'ok', extra: { idToken: 'x' } }] })).toThrow(
      'details key "idToken"',
    );
  });
});
