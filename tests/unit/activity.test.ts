import { describe, expect, it } from 'vitest';
import {
  type ActivityRow,
  activityWindowStart,
  outcomeOf,
  summarizeActivity,
  torontoDayKey,
} from '../../src/intents/activity.js';

// Friday Oct 9, 2026, 8:00 PM in Toronto (EDT, UTC-4).
const NOW = new Date('2026-10-10T00:00:00Z');

function row(createdAt: string, status: ActivityRow['status']): ActivityRow {
  return { createdAt: new Date(createdAt), status };
}

describe('outcomeOf', () => {
  it.each([
    ['FILLED', 'approved'],
    ['FAILED', 'approved'],
    ['POLICY_REJECTED', 'blocked'],
    ['EXPIRED', 'denied_or_expired'],
    ['DENIED', 'denied_or_expired'],
    ['PENDING_APPROVAL', 'waiting'],
  ] as const)('counts %s as %s', (status, outcome) => {
    expect(outcomeOf(status)).toBe(outcome);
  });
});

describe('torontoDayKey', () => {
  it('uses the Toronto calendar day, not the UTC one', () => {
    expect(torontoDayKey(new Date('2026-10-10T02:00:00Z'))).toBe('2026-10-09');
  });
});

describe('summarizeActivity', () => {
  it('returns one zero day per day shown when there are no orders', () => {
    const summary = summarizeActivity([], { now: NOW, days: 14 });

    expect(summary.days).toHaveLength(14);
    expect(summary.days[0]).toEqual({ label: 'Sep 26', proposed: 0, approved: 0 });
    expect(summary.days.at(-1)).toEqual({ label: 'Oct 9', proposed: 0, approved: 0 });
    expect(summary.weekdays.map((day) => day.weekday)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  it('counts proposed and approved orders on the Toronto day they were proposed', () => {
    const rows = [
      row('2026-10-09T15:00:00Z', 'FILLED'),
      row('2026-10-09T16:00:00Z', 'POLICY_REJECTED'),
      // 10 PM on Oct 8 in Toronto, already Oct 9 in UTC.
      row('2026-10-09T02:00:00Z', 'FILLED'),
    ];

    const summary = summarizeActivity(rows, { now: NOW, days: 14 });

    expect(summary.days.at(-1)).toEqual({ label: 'Oct 9', proposed: 2, approved: 1 });
    expect(summary.days.at(-2)).toEqual({ label: 'Oct 8', proposed: 1, approved: 1 });
  });

  it('groups outcomes by weekday', () => {
    const rows = [
      row('2026-10-09T15:00:00Z', 'FILLED'),
      row('2026-10-09T16:00:00Z', 'POLICY_REJECTED'),
      row('2026-10-05T15:00:00Z', 'EXPIRED'),
      row('2026-10-05T16:00:00Z', 'PENDING_APPROVAL'),
    ];

    const { weekdays } = summarizeActivity(rows, { now: NOW, days: 14 });

    expect(weekdays.find((day) => day.weekday === 'Fri')).toEqual({
      weekday: 'Fri',
      approved: 1,
      blocked: 1,
      deniedOrExpired: 0,
    });
    expect(weekdays.find((day) => day.weekday === 'Mon')).toEqual({
      weekday: 'Mon',
      approved: 0,
      blocked: 0,
      deniedOrExpired: 1,
    });
  });

  it('ignores orders from before the first day shown', () => {
    const rows = [row('2026-09-25T15:00:00Z', 'FILLED')];

    const summary = summarizeActivity(rows, { now: NOW, days: 14 });

    expect(summary.days.every((day) => day.proposed === 0)).toBe(true);
    expect(summary.weekdays.every((day) => day.approved === 0)).toBe(true);
  });

  it('never skips or repeats a day across a daylight-saving change', () => {
    const afterFallBack = new Date('2026-11-03T05:30:00Z');

    const labels = summarizeActivity([], { now: afterFallBack, days: 4 }).days.map(
      (day) => day.label,
    );

    expect(labels).toEqual(['Oct 31', 'Nov 1', 'Nov 2', 'Nov 3']);
  });
});

describe('activityWindowStart', () => {
  it('starts early enough to include the whole first day shown', () => {
    expect(activityWindowStart(NOW, 14).toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });
});
