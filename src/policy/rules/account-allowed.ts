import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function accountAllowed({ context }: RuleInput): RuleResult {
  if (context.account === null) {
    return fail('account_allowed', 'This account is unknown.');
  }
  if (!context.account.present) {
    return fail('account_allowed', 'This account is no longer available at SnapTrade.');
  }
  if (!context.account.allowed) {
    return fail(
      'account_allowed',
      "You haven't allowed the AI to use this account. You can allow it on the dashboard.",
    );
  }
  return pass('account_allowed', 'You allowed the AI to use this account.');
}
