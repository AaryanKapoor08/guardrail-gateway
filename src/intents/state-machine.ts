// The order intent lifecycle (PRODUCT_VISION §7). Pure: no database, network, or clock. Every
// status change in the app goes through `transition()`, so an illegal jump (say, from DENIED to
// FILLED) is impossible rather than merely unlikely.

export const INTENT_STATES = [
  'PROPOSED',
  'POLICY_REJECTED',
  'PENDING_APPROVAL',
  'DENIED',
  'EXPIRED',
  'CANCELLED',
  'APPROVED',
  'EXECUTING',
  'SUBMITTED',
  'UNKNOWN',
  'FILLED',
  'CLOSED',
  'FAILED',
] as const;
export type IntentState = (typeof INTENT_STATES)[number];

export const INTENT_EVENTS = [
  'POLICY_PASSED',
  'POLICY_FAILED',
  'USER_APPROVED',
  'USER_DENIED',
  'EXPIRE',
  'CANCEL',
  'RECHECK_FAILED',
  'RECHECK_PASSED',
  'PAPER_FILLED',
  'PAPER_NOT_MARKETABLE',
  'BROKER_ACCEPTED',
  'BROKER_REJECTED',
  'OUTCOME_UNKNOWN',
  'RECONCILED_FOUND',
  'USER_CONFIRMED_NOT_PLACED',
  'BROKER_FILLED',
  'BROKER_CLOSED',
] as const;
export type IntentEvent = (typeof INTENT_EVENTS)[number];

// The only legal transitions (V§7.2), exactly 17. A state with no entry accepts no events.
export const TRANSITIONS: Readonly<
  Record<IntentState, Readonly<Partial<Record<IntentEvent, IntentState>>>>
> = {
  PROPOSED: { POLICY_PASSED: 'PENDING_APPROVAL', POLICY_FAILED: 'POLICY_REJECTED' },
  PENDING_APPROVAL: {
    USER_APPROVED: 'APPROVED',
    USER_DENIED: 'DENIED',
    EXPIRE: 'EXPIRED',
    CANCEL: 'CANCELLED',
  },
  APPROVED: { RECHECK_FAILED: 'POLICY_REJECTED', RECHECK_PASSED: 'EXECUTING' },
  EXECUTING: {
    PAPER_FILLED: 'FILLED',
    PAPER_NOT_MARKETABLE: 'CLOSED',
    BROKER_ACCEPTED: 'SUBMITTED',
    BROKER_REJECTED: 'FAILED',
    OUTCOME_UNKNOWN: 'UNKNOWN',
  },
  UNKNOWN: { RECONCILED_FOUND: 'SUBMITTED', USER_CONFIRMED_NOT_PLACED: 'FAILED' },
  SUBMITTED: { BROKER_FILLED: 'FILLED', BROKER_CLOSED: 'CLOSED' },
  POLICY_REJECTED: {},
  DENIED: {},
  EXPIRED: {},
  CANCELLED: {},
  FILLED: {},
  CLOSED: {},
  FAILED: {},
};

export const TERMINAL_STATES: ReadonlySet<IntentState> = new Set([
  'POLICY_REJECTED',
  'DENIED',
  'EXPIRED',
  'CANCELLED',
  'FILLED',
  'CLOSED',
  'FAILED',
]);

// Intents that were, or still might be, sent to a broker count toward daily limits (V§8.3).
// Pending ones reserve budget, so the AI can't queue many small orders that each pass alone.
export const COUNTED_STATES: readonly IntentState[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'SUBMITTED',
  'UNKNOWN',
  'FILLED',
  'CLOSED',
];

// Sells that aren't finished yet (V§8.2 rule 6). Filled sells already show up in positions, so
// they are left out to avoid subtracting them twice.
export const OPEN_SELL_STATES: readonly IntentState[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'SUBMITTED',
  'UNKNOWN',
];

export class TransitionError extends Error {
  override readonly name = 'TransitionError';
  readonly state: IntentState;
  readonly event: IntentEvent;

  constructor(state: IntentState, event: IntentEvent) {
    super(`[Intents] ${event} is not allowed from ${state}`);
    this.state = state;
    this.event = event;
  }
}

export function transition(state: IntentState, event: IntentEvent): IntentState {
  const next = TRANSITIONS[state][event];
  if (next === undefined) {
    throw new TransitionError(state, event);
  }
  return next;
}
