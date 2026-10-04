import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function maxOrdersPerDay({ policy, context }: RuleInput): RuleResult {
  const orderNumber = context.todayCountedOrders + 1;
  if (orderNumber > policy.maxOrdersPerDay) {
    return fail(
      'max_orders_per_day',
      `You've reached your limit of ${policy.maxOrdersPerDay} orders today.`,
    );
  }
  return pass(
    'max_orders_per_day',
    `This would be order ${orderNumber} of the ${policy.maxOrdersPerDay} you allow per day.`,
  );
}
