import { add, cmp, fmtMoney } from '../../lib/money.js';
import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function maxDailyValue({ policy, context, estimatedValue }: RuleInput): RuleResult {
  if (estimatedValue === null) {
    return pass(
      'max_daily_value',
      "Skipped: the order value can't be estimated (no price or no valid quantity).",
    );
  }
  const totalToday = add(context.todayCountedValue, estimatedValue);
  const total = fmtMoney(totalToday, policy.policyCurrency);
  const limit = fmtMoney(policy.maxDailyValue, policy.policyCurrency);
  if (cmp(totalToday, policy.maxDailyValue) > 0) {
    return fail(
      'max_daily_value',
      `With this order, today's total would be ${total}, over your daily limit of ${limit}.`,
    );
  }
  return pass(
    'max_daily_value',
    `With this order, today's total would be ${total}, within your daily limit of ${limit}.`,
  );
}
