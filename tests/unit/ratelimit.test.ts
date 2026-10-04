import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/lib/ratelimit.js';
import { createTestClock } from '../helpers/clock.js';

function buildLimiter() {
  const clock = createTestClock();
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock.now });
  return { clock, limiter };
}

describe('rate limiter', () => {
  it('allows requests up to the limit, then refuses', () => {
    const { limiter } = buildLimiter();

    const results = [
      limiter.allowRequest('a'),
      limiter.allowRequest('a'),
      limiter.allowRequest('a'),
    ];

    expect(results).toEqual([true, true, false]);
  });

  it('counts each key separately', () => {
    const { limiter } = buildLimiter();
    limiter.allowRequest('a');
    limiter.allowRequest('a');

    expect(limiter.allowRequest('b')).toBe(true);
  });

  it('allows again once the oldest request leaves the window', () => {
    const { clock, limiter } = buildLimiter();
    limiter.allowRequest('a');
    clock.advanceMs(30_000);
    limiter.allowRequest('a');
    clock.advanceMs(30_001);

    expect(limiter.allowRequest('a')).toBe(true);
    expect(limiter.allowRequest('a')).toBe(false);
  });

  it('does not count refused requests', () => {
    const { clock, limiter } = buildLimiter();
    limiter.allowRequest('a');
    limiter.allowRequest('a');
    limiter.allowRequest('a');
    clock.advanceMs(60_001);

    expect(limiter.allowRequest('a')).toBe(true);
    expect(limiter.allowRequest('a')).toBe(true);
  });
});
