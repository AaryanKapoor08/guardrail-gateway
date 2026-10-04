import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// We have no exchange-rate source, so we refuse rather than guess with someone's money (D7).
export function currencySupported({ policy, context }: RuleInput): RuleResult {
  if (context.security === null) {
    return fail('currency_supported', "The security's currency is unknown.");
  }
  const { symbol, currency } = context.security;
  if (currency !== policy.policyCurrency) {
    return fail(
      'currency_supported',
      `${symbol} trades in ${currency}, but your limits are in ${policy.policyCurrency}. Orders in other currencies are refused because we don't convert currencies.`,
    );
  }
  return pass('currency_supported', `${symbol} trades in ${currency}, your policy currency.`);
}
