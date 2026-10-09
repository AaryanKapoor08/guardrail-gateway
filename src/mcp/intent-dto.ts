import { z } from 'zod';
import { CLAIM_STATUSES, type ClaimResult } from '../claims/check-claims.js';
import type { Env } from '../config/env.js';
import { INTENT_STATES } from '../intents/state-machine.js';
import { approvalUrlFor, type IntentView, shortSummary } from '../intents/view.js';
import { RULE_IDS } from '../policy/types.js';
import { isoOrNull } from './tool-kit.js';

// What the AI sees of an intent (V§11.2): our own resolved data, the approval link while it is
// pending, every check result, the claim check, and the fill. No SnapTrade ids, no internal ids
// beyond intent_id.

const ClaimCheckDtoSchema = z.object({
  claim: z.enum(['price', 'company', 'reasoning']),
  status: z.enum([...CLAIM_STATUSES, 'missing']),
  ai_said: z.string().nullable(),
  broker_says: z.string().nullable(),
  message: z.string(),
});

export const IntentDtoSchema = z.object({
  intent_id: z.string(),
  status: z.enum(INTENT_STATES),
  account_ref: z.string(),
  symbol: z.string(),
  side: z.enum(['buy', 'sell']),
  quantity: z.string(),
  order_type: z.enum(['market', 'limit']),
  limit_price: z.string().nullable(),
  mode: z.enum(['paper', 'live']),
  created_at: z.string(),
  expires_at: z.string(),
  approval_url: z.string().nullable(),
  estimate: z.object({
    price: z.string().nullable(),
    value: z.string().nullable(),
    currency: z.string(),
    price_source: z.string(),
    price_as_of: z.string().nullable(),
  }),
  checks: z.array(z.object({ rule: z.enum(RULE_IDS), passed: z.boolean(), reason: z.string() })),
  // How the AI's own claims (expected price, company) compared with the broker's data. Empty
  // for orders the user proposed themselves and for orders from before the claim check.
  claim_check: z.array(ClaimCheckDtoSchema),
  fill: z.object({ filled_quantity: z.string(), avg_fill_price: z.string().nullable() }).nullable(),
});

export type IntentDto = z.infer<typeof IntentDtoSchema>;

function toClaimCheckDto(result: ClaimResult): z.infer<typeof ClaimCheckDtoSchema> {
  if (result.claim === 'reasoning') {
    return { ...result, ai_said: null, broker_says: null };
  }
  return {
    claim: result.claim,
    status: result.status,
    ai_said: result.aiSaid,
    broker_says: result.brokerSays,
    message: result.message,
  };
}

export function toIntentDto(env: Env, intent: IntentView): IntentDto {
  const isPending = intent.status === 'PENDING_APPROVAL';
  return {
    intent_id: intent.id,
    status: intent.status,
    account_ref: intent.accountRef,
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    order_type: intent.orderType,
    limit_price: intent.limitPrice,
    mode: intent.mode,
    created_at: intent.createdAt.toISOString(),
    expires_at: intent.expiresAt.toISOString(),
    approval_url: isPending ? approvalUrlFor(env.APP_BASE_URL, intent.id) : null,
    estimate: {
      price: intent.estPrice,
      value: intent.estValue,
      currency: intent.currency,
      price_source: intent.priceSource,
      price_as_of: isoOrNull(intent.priceAsOf),
    },
    checks: intent.checkResults,
    claim_check: (intent.claimResults ?? []).map(toClaimCheckDto),
    fill:
      intent.execution === null
        ? null
        : {
            filled_quantity: intent.execution.filledQuantity,
            avg_fill_price: intent.execution.avgFillPrice,
          },
  };
}

// Tells the AI where its own beliefs were wrong, so it can correct itself with the user.
function describeDifferingClaims(intent: IntentDto): string {
  const differing = intent.claim_check.filter((check) => check.status === 'differs');
  if (differing.length === 0) {
    return '';
  }
  return ` Claim check: ${differing.map((check) => check.message).join(' ')} Tell the user about this difference.`;
}

// One line the AI can relay to the user, e.g. "BUY 1 XEQT.TO (paper) is waiting for approval".
export function describeIntentForAi(intent: IntentDto): string {
  return `${describeStatusForAi(intent)}${describeDifferingClaims(intent)}`;
}

function describeStatusForAi(intent: IntentDto): string {
  const order = `${shortSummary({ side: intent.side, quantity: intent.quantity, symbol: intent.symbol })} (${intent.mode})`;
  if (intent.status === 'PENDING_APPROVAL') {
    return `${order} is waiting for the user's approval. Ask them to review and approve it at ${intent.approval_url} before ${intent.expires_at}.`;
  }
  if (intent.status === 'POLICY_REJECTED') {
    const reasons = intent.checks.filter((check) => !check.passed).map((check) => check.reason);
    return `${order} was rejected by the user's policy: ${reasons.join(' ')}`;
  }
  if (intent.fill !== null && intent.fill.avg_fill_price !== null) {
    return `${order} is ${intent.status}: filled ${intent.fill.filled_quantity} at ${intent.fill.avg_fill_price} ${intent.estimate.currency}.`;
  }
  return `${order} is ${intent.status}.`;
}
