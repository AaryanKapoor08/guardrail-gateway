import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function sideAllowed({ policy, order }: RuleInput): RuleResult {
  const action = order.side === 'buy' ? 'Buying' : 'Selling';
  if (!policy.allowedSides.includes(order.side)) {
    return fail('side_allowed', `${action} isn't allowed by your policy.`);
  }
  return pass('side_allowed', `${action} is allowed by your policy.`);
}
