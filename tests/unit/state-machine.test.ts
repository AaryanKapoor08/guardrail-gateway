import { describe, expect, it } from 'vitest';
import {
  COUNTED_STATES,
  INTENT_EVENTS,
  INTENT_STATES,
  type IntentEvent,
  type IntentState,
  OPEN_SELL_STATES,
  TERMINAL_STATES,
  TransitionError,
  transition,
} from '../../src/intents/state-machine.js';

// Written out independently from PRODUCT_VISION §7.2, so a typo in the implementation's table
// can't also hide in the test.
const LEGAL: ReadonlyArray<readonly [IntentState, IntentEvent, IntentState]> = [
  ['PROPOSED', 'POLICY_PASSED', 'PENDING_APPROVAL'],
  ['PROPOSED', 'POLICY_FAILED', 'POLICY_REJECTED'],
  ['PENDING_APPROVAL', 'USER_APPROVED', 'APPROVED'],
  ['PENDING_APPROVAL', 'USER_DENIED', 'DENIED'],
  ['PENDING_APPROVAL', 'EXPIRE', 'EXPIRED'],
  ['PENDING_APPROVAL', 'CANCEL', 'CANCELLED'],
  ['APPROVED', 'RECHECK_FAILED', 'POLICY_REJECTED'],
  ['APPROVED', 'RECHECK_PASSED', 'EXECUTING'],
  ['EXECUTING', 'PAPER_FILLED', 'FILLED'],
  ['EXECUTING', 'PAPER_NOT_MARKETABLE', 'CLOSED'],
  ['EXECUTING', 'BROKER_ACCEPTED', 'SUBMITTED'],
  ['EXECUTING', 'BROKER_REJECTED', 'FAILED'],
  ['EXECUTING', 'OUTCOME_UNKNOWN', 'UNKNOWN'],
  ['UNKNOWN', 'RECONCILED_FOUND', 'SUBMITTED'],
  ['UNKNOWN', 'USER_CONFIRMED_NOT_PLACED', 'FAILED'],
  ['SUBMITTED', 'BROKER_FILLED', 'FILLED'],
  ['SUBMITTED', 'BROKER_CLOSED', 'CLOSED'],
];

function expectedTarget(state: IntentState, event: IntentEvent): IntentState | undefined {
  return LEGAL.find(([from, on]) => from === state && on === event)?.[2];
}

const ALL_PAIRS = INTENT_STATES.flatMap((state) =>
  INTENT_EVENTS.map((event) => [state, event] as const),
);

describe('transition', () => {
  it('covers 13 states × 17 events = 221 pairs', () => {
    expect(INTENT_STATES).toHaveLength(13);
    expect(INTENT_EVENTS).toHaveLength(17);
    expect(ALL_PAIRS).toHaveLength(221);
  });

  it.each(ALL_PAIRS)('%s + %s', (state, event) => {
    const target = expectedTarget(state, event);
    if (target === undefined) {
      expect(() => transition(state, event)).toThrow(TransitionError);
    } else {
      expect(transition(state, event)).toBe(target);
    }
  });

  it('allows exactly the 17 transitions in V§7.2', () => {
    const legalCount = ALL_PAIRS.filter(([state, event]) => {
      try {
        transition(state, event);
        return true;
      } catch {
        return false;
      }
    }).length;

    expect(legalCount).toBe(17);
  });

  it('names the state and event in the error', () => {
    expect(() => transition('DENIED', 'PAPER_FILLED')).toThrow(
      '[Intents] PAPER_FILLED is not allowed from DENIED',
    );
  });

  it.each([...TERMINAL_STATES])('accepts no event in terminal state %s', (state) => {
    for (const event of INTENT_EVENTS) {
      expect(() => transition(state, event)).toThrow(TransitionError);
    }
  });
});

describe('state groups', () => {
  it('has the 7 terminal states of V§7.1', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      ['CANCELLED', 'CLOSED', 'DENIED', 'EXPIRED', 'FAILED', 'FILLED', 'POLICY_REJECTED'].sort(),
    );
  });

  it('counts toward daily limits everything that was or might be sent to a broker', () => {
    expect([...COUNTED_STATES].sort()).toEqual(
      [
        'APPROVED',
        'CLOSED',
        'EXECUTING',
        'FILLED',
        'PENDING_APPROVAL',
        'SUBMITTED',
        'UNKNOWN',
      ].sort(),
    );
  });

  it('treats only unfinished sells as open', () => {
    expect([...OPEN_SELL_STATES].sort()).toEqual(
      ['APPROVED', 'EXECUTING', 'PENDING_APPROVAL', 'SUBMITTED', 'UNKNOWN'].sort(),
    );
  });
});
