import type { IntentState } from '../intents/state-machine.js';
import type { IntentView } from '../intents/view.js';
import { fmtMoney } from '../lib/money.js';
import { fmtToronto } from '../lib/time.js';
import { securityTypeLabel } from '../policy/rules/asset-type-allowed.js';

// Plain-English labels shared by the pages.

const STATUS_LABELS: Readonly<Record<IntentState, string>> = {
  PROPOSED: 'Being checked',
  POLICY_REJECTED: 'Rejected by your policy',
  PENDING_APPROVAL: 'Waiting for your approval',
  DENIED: 'Denied by you',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  APPROVED: 'Approved',
  EXECUTING: 'Executing',
  SUBMITTED: 'Sent to the broker',
  UNKNOWN: 'Outcome unknown (check your broker)',
  FILLED: 'Filled',
  CLOSED: 'Closed without a full fill',
  FAILED: 'Failed',
};

export function statusLabel(status: IntentState): string {
  return STATUS_LABELS[status];
}

export function sideLabel(side: IntentView['side']): string {
  return side === 'buy' ? 'Buy' : 'Sell';
}

export function orderTypeLabel(intent: Pick<IntentView, 'orderType' | 'limitPrice' | 'currency'>) {
  if (intent.orderType === 'market' || intent.limitPrice === null) {
    return 'Market';
  }
  return `Limit at ${fmtMoney(intent.limitPrice, intent.currency)}`;
}

export function typeLabel(typeCode: string): string {
  return securityTypeLabel(typeCode);
}

export function moneyOrDash(value: string | null, currency: string): string {
  return value === null ? '—' : fmtMoney(value, currency);
}

// V§9.2: the source of every estimate is labelled.
export function priceSourceDetail(intent: Pick<IntentView, 'priceSource' | 'priceAsOf'>): string {
  const asOf = intent.priceAsOf === null ? '' : ` (as of ${fmtToronto(intent.priceAsOf)})`;
  switch (intent.priceSource) {
    case 'quote':
      return `Latest available quote from your broker, may be delayed${asOf}`;
    case 'limit':
      return 'Your limit price (the most you would pay or the least you would accept)';
    case 'position':
      return `Price from your last account sync${asOf}`;
    default:
      return 'Not available';
  }
}

export function maskedNumber(last4: string | null): string {
  return last4 === null ? 'number not provided' : `••••${last4}`;
}
