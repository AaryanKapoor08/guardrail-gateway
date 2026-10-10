import { and, eq, gte } from 'drizzle-orm';
import type { DatabaseExecutor } from '../db/client.js';
import { orderIntents } from '../db/schema.js';
import { TORONTO } from '../lib/time.js';
import type { IntentState } from './state-machine.js';

// The dashboard charts: how many orders were proposed, approved, or blocked per day and per
// weekday. Counting is pure; the one query only reads the time and status of each order.

export type ActivityRow = { readonly createdAt: Date; readonly status: IntentState };

export async function listOrderActivity(
  db: DatabaseExecutor,
  userId: string,
  since: Date,
): Promise<ActivityRow[]> {
  return db
    .select({ createdAt: orderIntents.createdAt, status: orderIntents.status })
    .from(orderIntents)
    .where(and(eq(orderIntents.userId, userId), gte(orderIntents.createdAt, since)));
}

export type Outcome = 'approved' | 'blocked' | 'denied_or_expired' | 'waiting';

// "Approved" means the user approved it, whatever the broker did next.
const OUTCOME_OF_STATUS: Readonly<Record<IntentState, Outcome>> = {
  PROPOSED: 'waiting',
  PENDING_APPROVAL: 'waiting',
  POLICY_REJECTED: 'blocked',
  DENIED: 'denied_or_expired',
  EXPIRED: 'denied_or_expired',
  CANCELLED: 'denied_or_expired',
  APPROVED: 'approved',
  EXECUTING: 'approved',
  SUBMITTED: 'approved',
  UNKNOWN: 'approved',
  FILLED: 'approved',
  CLOSED: 'approved',
  FAILED: 'approved',
};

export function outcomeOf(status: IntentState): Outcome {
  return OUTCOME_OF_STATUS[status];
}

export type DayCount = {
  readonly label: string;
  readonly proposed: number;
  readonly approved: number;
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type WeekdayCount = {
  readonly weekday: Weekday;
  readonly approved: number;
  readonly blocked: number;
  readonly deniedOrExpired: number;
};

export type ActivitySummary = {
  readonly days: readonly DayCount[];
  readonly weekdays: readonly WeekdayCount[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

const torontoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: TORONTO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const torontoWeekday = new Intl.DateTimeFormat('en-US', { timeZone: TORONTO, weekday: 'short' });

const shortDayLabel = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
});

// "2026-10-09": the calendar day in Toronto, the time zone every page shows.
export function torontoDayKey(date: Date): string {
  return torontoDate.format(date);
}

// Calendar maths on UTC midnights, so a daylight-saving change never skips or repeats a day.
function previousDays(now: Date, days: number): Date[] {
  const today = new Date(`${torontoDayKey(now)}T00:00:00Z`);
  return Array.from(
    { length: days },
    (_, index) => new Date(today.getTime() - (days - 1 - index) * DAY_MS),
  );
}

// Early enough to include every order from the first day shown; older rows are ignored.
export function activityWindowStart(now: Date, days: number): Date {
  return new Date(now.getTime() - (days + 1) * DAY_MS);
}

function countDays(rows: readonly ActivityRow[], dayStarts: readonly Date[]): DayCount[] {
  return dayStarts.map((dayStart) => {
    const key = dayStart.toISOString().slice(0, 10);
    const sameDay = rows.filter((row) => torontoDayKey(row.createdAt) === key);
    return {
      label: shortDayLabel.format(dayStart),
      proposed: sameDay.length,
      approved: sameDay.filter((row) => outcomeOf(row.status) === 'approved').length,
    };
  });
}

function countWeekdays(rows: readonly ActivityRow[]): WeekdayCount[] {
  return WEEKDAYS.map((weekday) => {
    const outcomes = rows
      .filter((row) => torontoWeekday.format(row.createdAt) === weekday)
      .map((row) => outcomeOf(row.status));
    return {
      weekday,
      approved: outcomes.filter((outcome) => outcome === 'approved').length,
      blocked: outcomes.filter((outcome) => outcome === 'blocked').length,
      deniedOrExpired: outcomes.filter((outcome) => outcome === 'denied_or_expired').length,
    };
  });
}

// Counts for the last `days` Toronto calendar days, today included.
export function summarizeActivity(
  rows: readonly ActivityRow[],
  options: { now: Date; days: number },
): ActivitySummary {
  const dayStarts = previousDays(options.now, options.days);
  const shownKeys = new Set(dayStarts.map((dayStart) => dayStart.toISOString().slice(0, 10)));
  const shownRows = rows.filter((row) => shownKeys.has(torontoDayKey(row.createdAt)));
  return { days: countDays(shownRows, dayStarts), weekdays: countWeekdays(shownRows) };
}
