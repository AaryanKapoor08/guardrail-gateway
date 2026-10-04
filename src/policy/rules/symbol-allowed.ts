import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// The blocked list always wins. An empty allowed list means every symbol is allowed.
export function symbolAllowed({ policy, context }: RuleInput): RuleResult {
  if (context.security === null) {
    return fail('symbol_allowed', 'The symbol is unknown.');
  }
  const symbol = context.security.symbol.toUpperCase();
  if (policy.symbolDenylist.includes(symbol)) {
    return fail('symbol_allowed', `${symbol} is on your blocked symbols list.`);
  }
  if (policy.symbolAllowlist.length > 0 && !policy.symbolAllowlist.includes(symbol)) {
    return fail('symbol_allowed', `${symbol} isn't on your allowed symbols list.`);
  }
  return pass('symbol_allowed', `${symbol} is allowed by your symbol lists.`);
}
