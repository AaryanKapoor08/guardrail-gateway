import { cmp, fmtMoney } from '../../lib/money.js';
import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// Applies to buys and sells alike, so the limits also cap panic-selling.
export function maxOrderValue({ policy, estimatedValue }: RuleInput): RuleResult {
  // The price or quantity rule already failed; one problem shouldn't be reported three times.
  if (estimatedValue === null) {
    return pass(
      'max_order_value',
      "Skipped: the order value can't be estimated (no price or no valid quantity).",
    );
  }
  const value = fmtMoney(estimatedValue, policy.policyCurrency);
  const limit = fmtMoney(policy.maxOrderValue, policy.policyCurrency);
  if (cmp(estimatedValue, policy.maxOrderValue) > 0) {
    return fail(
      'max_order_value',
      `Order value ${value} exceeds your per-order limit of ${limit}.`,
    );
  }
  return pass(
    'max_order_value',
    `Order value ${value} is within your per-order limit of ${limit}.`,
  );
}
