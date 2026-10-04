import type { RuleId, RuleResult } from '../types.js';

export function pass(rule: RuleId, reason: string): RuleResult {
  return { rule, passed: true, reason };
}

export function fail(rule: RuleId, reason: string): RuleResult {
  return { rule, passed: false, reason };
}
