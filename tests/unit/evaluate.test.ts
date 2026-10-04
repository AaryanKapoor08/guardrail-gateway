import { describe, expect, it } from 'vitest';
import { describePolicy } from '../../src/policy/describe.js';
import { estimateValue, evaluate } from '../../src/policy/evaluate.js';
import { RULE_IDS } from '../../src/policy/types.js';
import { buildContext, buildOrder, buildPolicy } from '../helpers/policy-builders.js';

describe('evaluate', () => {
  it('runs all 16 rules in order and passes a valid order', () => {
    const evaluation = evaluate(buildPolicy(), buildOrder(), buildContext());

    expect(evaluation.pass).toBe(true);
    expect(evaluation.results.map((result) => result.rule)).toEqual([...RULE_IDS]);
    expect(evaluation.estimatedValue).toBe('96.40');
  });

  it('reports every failure, not just the first', () => {
    const evaluation = evaluate(
      buildPolicy(),
      buildOrder({ quantity: '10' }),
      buildContext({ killSwitch: true, price: { value: '152.40', source: 'quote', asOf: null } }),
    );

    const failed = evaluation.results.filter((result) => !result.passed).map((r) => r.rule);
    expect(evaluation.pass).toBe(false);
    expect(failed).toEqual(['kill_switch_off', 'max_order_value', 'max_daily_value']);
  });

  it('fails the whole evaluation when any single rule fails', () => {
    const evaluation = evaluate(buildPolicy(), buildOrder({ side: 'sell' }), buildContext());

    expect(evaluation.pass).toBe(false);
  });
});

describe('estimateValue', () => {
  const price = (value: string) => ({ value, source: 'quote' as const, asOf: null });

  it('multiplies exactly and rounds half-up to cents', () => {
    expect(estimateValue('3', price('33.335'))).toBe('100.01');
    expect(estimateValue('0.5', price('152.40'))).toBe('76.20');
    expect(estimateValue('3', price('0.1'))).toBe('0.30');
  });

  it('is null without a price or a usable quantity', () => {
    expect(estimateValue('1', null)).toBeNull();
    expect(estimateValue('one', price('10'))).toBeNull();
    expect(estimateValue('0', price('10'))).toBeNull();
  });
});

describe('describePolicy', () => {
  it('describes the default policy in plain language', () => {
    const lines = describePolicy(buildPolicy(), { mode: 'paper', killSwitch: false });

    expect(lines).toContain('Mode: paper. Orders are simulated; nothing is sent to a broker.');
    expect(lines).toContain('Kill switch: off.');
    expect(lines).toContain('Allowed actions: buy only.');
    expect(lines).toContain('Per-order limit: $100.00 CAD.');
    expect(lines).toContain(
      'Daily limit: $250.00 CAD across at most 5 orders (orders waiting for approval count too).',
    );
    expect(lines).toContain('Symbols: any symbol.');
  });

  it('describes live mode, the kill switch, selling, and symbol lists', () => {
    const lines = describePolicy(
      buildPolicy({
        allowedSides: ['buy', 'sell'],
        symbolAllowlist: ['VFV.TO', 'XEQT.TO'],
        symbolDenylist: ['TSLA'],
      }),
      { mode: 'live', killSwitch: true },
    );

    expect(lines).toContain('Mode: live. Approved orders are sent to the broker.');
    expect(lines).toContain('Kill switch: ON. No orders are accepted until the user turns it off.');
    expect(lines).toContain('Allowed actions: buy and sell (never more than you hold).');
    expect(lines).toContain('Symbols: only VFV.TO, XEQT.TO, except TSLA.');
  });

  it('describes a sell-only policy', () => {
    const lines = describePolicy(buildPolicy({ allowedSides: ['sell'] }), {
      mode: 'paper',
      killSwitch: false,
    });

    expect(lines).toContain('Allowed actions: sell only (never more than you hold).');
  });
});
