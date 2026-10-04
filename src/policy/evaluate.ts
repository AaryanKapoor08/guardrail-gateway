import { isDecimalString, isPositive, mul, roundCents } from '../lib/money.js';
import { accountAllowed } from './rules/account-allowed.js';
import { approvalRequired } from './rules/approval-required.js';
import { assetTypeAllowed } from './rules/asset-type-allowed.js';
import { connectionHealthy } from './rules/connection-healthy.js';
import { currencySupported } from './rules/currency-supported.js';
import { killSwitchOff } from './rules/kill-switch-off.js';
import { maxDailyValue } from './rules/max-daily-value.js';
import { maxOrderValue } from './rules/max-order-value.js';
import { maxOrdersPerDay } from './rules/max-orders-per-day.js';
import { modeAllowed } from './rules/mode-allowed.js';
import { noShortSelling } from './rules/no-short-selling.js';
import { orderTypeAllowed } from './rules/order-type-allowed.js';
import { priceAvailable } from './rules/price-available.js';
import { quantityValid } from './rules/quantity-valid.js';
import { sideAllowed } from './rules/side-allowed.js';
import { symbolAllowed } from './rules/symbol-allowed.js';
import type { PolicyRules } from './schema.js';
import type { OrderRequest, PolicyContext, Rule, RuleResult } from './types.js';

// In the order of V§8.2, which is also the order the AI and the user see them.
const RULES: readonly Rule[] = [
  killSwitchOff,
  connectionHealthy,
  accountAllowed,
  modeAllowed,
  sideAllowed,
  noShortSelling,
  assetTypeAllowed,
  symbolAllowed,
  orderTypeAllowed,
  quantityValid,
  currencySupported,
  priceAvailable,
  maxOrderValue,
  maxDailyValue,
  maxOrdersPerDay,
  approvalRequired,
];

export type Evaluation = {
  readonly pass: boolean;
  readonly results: RuleResult[];
  readonly estimatedValue: string | null;
};

// Quantity × price, rounded half-up to cents. Null when either is unusable.
export function estimateValue(quantity: string, price: PolicyContext['price']): string | null {
  if (price === null || !isDecimalString(quantity) || !isPositive(quantity)) {
    return null;
  }
  return roundCents(mul(quantity, price.value));
}

// Runs every rule, with no short-circuit, so the AI and the user see every problem at once.
export function evaluate(
  policy: PolicyRules,
  order: OrderRequest,
  context: PolicyContext,
): Evaluation {
  const estimatedValue = estimateValue(order.quantity, context.price);
  const results = RULES.map((rule) => rule({ policy, order, context, estimatedValue }));
  return { pass: results.every((result) => result.passed), results, estimatedValue };
}
