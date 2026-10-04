import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type PolicyRules, PolicyRulesSchema } from '../../src/policy/schema.js';

function withChanges(changes: Record<string, unknown>): unknown {
  return { ...DEFAULT_POLICY, ...changes };
}

function isValid(rules: unknown): boolean {
  return PolicyRulesSchema.safeParse(rules).success;
}

describe('PolicyRulesSchema', () => {
  it('accepts the strict default policy', () => {
    expect(PolicyRulesSchema.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });

  it('defaults to buys only, small limits, and paper-friendly settings', () => {
    const expected: Partial<PolicyRules> = {
      allowedSides: ['buy'],
      maxOrderValue: '100',
      maxDailyValue: '250',
      maxOrdersPerDay: 5,
      policyCurrency: 'CAD',
      approvalWindowMinutes: 10,
    };
    expect(DEFAULT_POLICY).toMatchObject(expected);
  });

  it.each([
    ['per-order limit at the ceiling', { maxOrderValue: '10000' }, true],
    ['per-order limit over the ceiling', { maxOrderValue: '10000.01' }, false],
    ['daily limit at the ceiling', { maxDailyValue: '50000' }, true],
    ['daily limit over the ceiling', { maxDailyValue: '50001' }, false],
    ['orders per day at the ceiling', { maxOrdersPerDay: 50 }, true],
    ['orders per day over the ceiling', { maxOrdersPerDay: 51 }, false],
    ['zero orders per day', { maxOrdersPerDay: 0 }, false],
    ['approval window of 5 minutes', { approvalWindowMinutes: 5 }, true],
    ['approval window of 4 minutes', { approvalWindowMinutes: 4 }, false],
    ['approval window of 30 minutes', { approvalWindowMinutes: 30 }, true],
    ['approval window of 31 minutes', { approvalWindowMinutes: 31 }, false],
  ])('enforces hard ceilings: %s', (_name, changes, expected) => {
    expect(isValid(withChanges(changes))).toBe(expected);
  });

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['three decimal places', '10.005'],
    ['exponent notation', '1e3'],
    ['text', 'lots'],
    ['empty', ''],
  ])('rejects a bad money value: %s', (_name, value) => {
    expect(isValid(withChanges({ maxOrderValue: value }))).toBe(false);
  });

  it('accepts money with two decimal places, or trailing zeros', () => {
    expect(isValid(withChanges({ maxOrderValue: '99.50' }))).toBe(true);
    expect(isValid(withChanges({ maxOrderValue: '99.500' }))).toBe(true);
  });

  it('uppercases symbols in the lists', () => {
    const parsed = PolicyRulesSchema.parse(
      withChanges({ symbolAllowlist: ['vfv.to'], symbolDenylist: [' tsla '] }),
    );

    expect(parsed.symbolAllowlist).toEqual(['VFV.TO']);
    expect(parsed.symbolDenylist).toEqual(['TSLA']);
  });

  it.each([
    ['a space inside', 'VF V'],
    ['a slash', 'VFV/TO'],
    ['too long', 'A'.repeat(21)],
    ['empty', ''],
    ['an HTML tag', '<b>'],
  ])('rejects a bad symbol: %s', (_name, symbol) => {
    expect(isValid(withChanges({ symbolDenylist: [symbol] }))).toBe(false);
  });

  it('rejects an unknown side, asset type, or currency', () => {
    expect(isValid(withChanges({ allowedSides: ['short'] }))).toBe(false);
    expect(isValid(withChanges({ assetTypes: ['crypto'] }))).toBe(false);
    expect(isValid(withChanges({ policyCurrency: 'EUR' }))).toBe(false);
  });

  it('rejects a policy with no allowed sides', () => {
    expect(isValid(withChanges({ allowedSides: [] }))).toBe(false);
  });
});
