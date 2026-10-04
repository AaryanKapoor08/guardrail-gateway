import { describe, expect, it } from 'vitest';
import { fmtToronto } from '../../src/lib/time.js';

describe('fmtToronto', () => {
  it('formats a time in Toronto time during daylight saving', () => {
    expect(fmtToronto(new Date('2026-10-03T18:32:00Z'))).toBe('Oct 3, 2026, 2:32 PM ET');
  });

  it('formats a time in Toronto time during standard time', () => {
    expect(fmtToronto(new Date('2026-01-15T14:05:00Z'))).toBe('Jan 15, 2026, 9:05 AM ET');
  });
});
