import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function connectionHealthy({ context }: RuleInput): RuleResult {
  if (context.connection === null) {
    return fail('connection_healthy', "We couldn't find this account's brokerage connection.");
  }
  if (context.connection.disabled) {
    return fail(
      'connection_healthy',
      "This account's brokerage connection is broken. Fix it in your SnapTrade dashboard.",
    );
  }
  return pass('connection_healthy', 'The brokerage connection is working.');
}
