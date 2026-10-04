import { isDecimalString, isPositive } from '../../lib/money.js';
import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function orderTypeAllowed({ policy, order }: RuleInput): RuleResult {
  const label = order.orderType === 'market' ? 'Market' : 'Limit';
  if (!policy.orderTypes.includes(order.orderType)) {
    return fail('order_type_allowed', `${label} orders aren't allowed by your policy.`);
  }
  if (order.orderType === 'limit') {
    const limitPrice = order.limitPrice ?? '';
    if (!isDecimalString(limitPrice) || !isPositive(limitPrice)) {
      return fail('order_type_allowed', 'A limit order needs a limit price above 0.');
    }
  }
  return pass('order_type_allowed', `${label} orders are allowed; the order lasts for the day.`);
}
