import { decimalPlaces, isDecimalString, isPositive } from '../../lib/money.js';
import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

const MAX_QUANTITY_DECIMAL_PLACES = 6;

export function quantityValid({ order }: RuleInput): RuleResult {
  if (!isDecimalString(order.quantity) || !isPositive(order.quantity)) {
    return fail('quantity_valid', 'The quantity must be a number above 0.');
  }
  if (decimalPlaces(order.quantity) > MAX_QUANTITY_DECIMAL_PLACES) {
    return fail('quantity_valid', 'The quantity can have at most 6 decimal places.');
  }
  // Brokers differ on fractional shares, so live orders are whole shares only in v1.
  if (order.mode === 'live' && decimalPlaces(order.quantity) > 0) {
    return fail('quantity_valid', 'Live orders must be for whole shares.');
  }
  return pass('quantity_valid', `The quantity ${order.quantity} is valid.`);
}
