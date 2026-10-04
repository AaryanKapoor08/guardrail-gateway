import { fmtMoney } from '../../lib/money.js';
import type { PriceSource, RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

const SOURCE_LABELS: Readonly<Record<PriceSource, string>> = {
  quote: "the broker's latest quote (may be delayed)",
  limit: 'your limit price',
  position: 'the price from your last account sync',
};

export function priceSourceLabel(source: PriceSource): string {
  return SOURCE_LABELS[source];
}

export function priceAvailable({ policy, context }: RuleInput): RuleResult {
  if (context.price === null) {
    const symbol = context.security?.symbol ?? 'this security';
    return fail(
      'price_available',
      `No price is available for ${symbol}, so the order value can't be checked.`,
    );
  }
  const price = fmtMoney(context.price.value, context.security?.currency ?? policy.policyCurrency);
  return pass(
    'price_available',
    `Estimated price ${price}, from ${priceSourceLabel(context.price.source)}.`,
  );
}
