import { cmp, dec, isDecimalString } from '../../lib/money.js';
import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// A sell can't exceed what the user holds minus what other open sell intents already promise
// (V§8.2 rule 6), so the AI can never sell shares the user doesn't have.
export function noShortSelling({ order, context }: RuleInput): RuleResult {
  if (order.side === 'buy') {
    return pass('no_short_selling', 'This is a buy, so nothing is being oversold.');
  }
  if (!isDecimalString(order.quantity)) {
    // The quantity rule already reports this.
    return pass('no_short_selling', "Skipped: the quantity isn't a valid number.");
  }
  const available = dec(context.heldQuantity).minus(dec(context.openSellQuantity)).toFixed();
  const holding = `You hold ${context.heldQuantity}, with ${context.openSellQuantity} already in other open sell orders`;
  if (cmp(order.quantity, available) > 0) {
    return fail(
      'no_short_selling',
      `${holding}, so you can sell at most ${available}. Short selling isn't allowed.`,
    );
  }
  return pass('no_short_selling', `${holding}, so selling ${order.quantity} is covered.`);
}
