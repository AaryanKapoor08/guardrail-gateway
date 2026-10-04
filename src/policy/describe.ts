import { fmtMoney } from '../lib/money.js';
import type { PolicyRules } from './schema.js';
import type { Mode } from './types.js';

function describeSides(rules: PolicyRules): string {
  const canBuy = rules.allowedSides.includes('buy');
  const canSell = rules.allowedSides.includes('sell');
  if (canBuy && canSell) {
    return 'Allowed actions: buy and sell (never more than you hold).';
  }
  return canBuy
    ? 'Allowed actions: buy only.'
    : 'Allowed actions: sell only (never more than you hold).';
}

function describeSymbols(rules: PolicyRules): string {
  const allowed =
    rules.symbolAllowlist.length === 0 ? 'any symbol' : `only ${rules.symbolAllowlist.join(', ')}`;
  const blocked =
    rules.symbolDenylist.length === 0 ? '' : `, except ${rules.symbolDenylist.join(', ')}`;
  return `Symbols: ${allowed}${blocked}.`;
}

// The policy in plain language, for the AI (`get_policy`) and the dashboard.
export function describePolicy(
  rules: PolicyRules,
  state: { mode: Mode; killSwitch: boolean },
): string[] {
  const currency = rules.policyCurrency;
  return [
    state.mode === 'paper'
      ? 'Mode: paper. Orders are simulated; nothing is sent to a broker.'
      : 'Mode: live. Approved orders are sent to the broker.',
    state.killSwitch
      ? 'Kill switch: ON. No orders are accepted until the user turns it off.'
      : 'Kill switch: off.',
    describeSides(rules),
    'Security types: stocks and ETFs only.',
    'Order types: market and limit; every order lasts for the day only.',
    `Per-order limit: ${fmtMoney(rules.maxOrderValue, currency)}.`,
    `Daily limit: ${fmtMoney(rules.maxDailyValue, currency)} across at most ${rules.maxOrdersPerDay} orders (orders waiting for approval count too).`,
    describeSymbols(rules),
    `Currency: ${currency} only. Securities in other currencies are refused.`,
    `Approval: every order needs the user's approval on the Guardrail Gateway website within ${rules.approvalWindowMinutes} minutes.`,
  ];
}
