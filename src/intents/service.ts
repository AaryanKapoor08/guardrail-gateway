import { and, eq } from 'drizzle-orm';
import { sendApprovalEmail } from '../approvals/email.js';
import { type Actor, writeAudit } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { type LockedUser, lockExistingUser } from '../db/locks.js';
import { orderIntents, users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { ConflictError, NeedsReauthError, NotFoundError, reconnectMessage } from '../lib/errors.js';
import { type Evaluation, evaluate } from '../policy/evaluate.js';
import type { OrderRequest } from '../policy/types.js';
import { loadPolicy } from '../settings/policy-store.js';
import {
  buildPolicyContext,
  dbCounts,
  grantHasTradeScope,
  loadDecisionAccount,
  type Prefetched,
  prefetch,
} from './context.js';
import { expireDue } from './expiry.js';
import {
  describeInputProblem,
  orderFingerprint,
  type ProposeOrderInput,
  ProposeOrderInputSchema,
} from './propose-input.js';
import type { IntentState } from './state-machine.js';
import { type ResolvedSecurity, resolveSymbol } from './symbols.js';
import { applyTransition } from './transitions.js';
import { approvalUrlFor, type IntentView, listIntentViews, requireIntentView } from './view.js';

// Proposing orders and reading intents (PRODUCT_VISION §4.3, §7, §8). Every change is one
// transaction: user row lock → transition() + guarded UPDATE + audit row. Network reads (symbol
// search, quotes, positions) always happen before the transaction. Approvals, denials, and
// cancels are in decisions.ts; the kill switch and mode in controls.ts.

export type Proposer = {
  readonly actor: Extract<Actor, 'ai' | 'user'>;
  // The AI client host (e.g. 'claude.ai'), or 'manual test' / 'guided demo' for the user.
  readonly actorDetail: string;
  readonly grantId: string | null;
};

export type ProposeResult =
  | { readonly kind: 'intent'; readonly intent: IntentView; readonly approvalUrl: string }
  | { readonly kind: 'invalid_input'; readonly reason: string; readonly candidates: string[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

export const BROKER_UNAVAILABLE =
  "Couldn't get fresh data from your broker. Try again in a minute (or reconnect SnapTrade).";

// Expected trouble talking to SnapTrade becomes a plain message; nothing was changed.
export function unavailableReason(deps: Deps, error: unknown, userId: string): string {
  if (error instanceof NeedsReauthError) {
    return reconnectMessage(deps.env.APP_BASE_URL);
  }
  deps.logger.logError('[Intents] SnapTrade read failed', error, { userId });
  return BROKER_UNAVAILABLE;
}

// ---- Reads ------------------------------------------------------------------------------

export async function getIntent(deps: Deps, userId: string, intentId: string): Promise<IntentView> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, userId);
    await expireDue(tx, userId, deps.now());
    return requireIntentView(tx, userId, intentId);
  });
}

export async function listRecentIntents(
  deps: Deps,
  userId: string,
  options: { limit: number; statuses?: readonly IntentState[] },
): Promise<IntentView[]> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, userId);
    await expireDue(tx, userId, deps.now());
    return listIntentViews(tx, userId, options);
  });
}

// ---- Proposing --------------------------------------------------------------------------

// Same key and same order: the existing intent. Same key and a different order: an error,
// like Stripe (V§8.4). Returns null when the key is new (or no key was sent).
async function findIdempotentIntent(
  db: Deps['db'] | Transaction,
  request: { userId: string; input: ProposeOrderInput; fingerprint: string },
): Promise<string | null> {
  const key = request.input.idempotency_key;
  if (key === undefined) {
    return null;
  }
  const [existing] = await db
    .select({ id: orderIntents.id, fingerprint: orderIntents.fingerprint })
    .from(orderIntents)
    .where(and(eq(orderIntents.userId, request.userId), eq(orderIntents.idempotencyKey, key)));
  if (existing === undefined) {
    return null;
  }
  if (existing.fingerprint !== request.fingerprint) {
    throw new ConflictError('This idempotency key was already used for a different order.');
  }
  return existing.id;
}

type DecideRequest = {
  readonly userId: string;
  readonly proposer: Proposer;
  readonly input: ProposeOrderInput;
  readonly fingerprint: string;
  readonly security: ResolvedSecurity;
  readonly prefetched: Prefetched;
};

function orderFromInput(input: ProposeOrderInput, mode: 'paper' | 'live'): OrderRequest {
  return {
    side: input.side,
    quantity: input.quantity,
    orderType: input.order_type,
    limitPrice: input.limit_price,
    mode,
  };
}

export function decisionColumns(evaluation: Evaluation, prefetched: Prefetched) {
  return {
    checkResults: evaluation.results,
    estPrice: prefetched.price?.value ?? null,
    estValue: evaluation.estimatedValue,
    priceSource: prefetched.price?.source ?? 'none',
    priceAsOf: prefetched.price?.asOf ?? null,
  };
}

export function failedRules(evaluation: Evaluation): string[] {
  return evaluation.results.filter((result) => !result.passed).map((result) => result.rule);
}

async function insertProposedIntent(
  tx: Transaction,
  request: DecideRequest & {
    user: LockedUser;
    evaluation: Evaluation;
    policyVersion: number;
    expiresAt: Date;
    now: Date;
  },
): Promise<string> {
  const { input, security } = request;
  const [inserted] = await tx
    .insert(orderIntents)
    .values({
      userId: request.userId,
      accountId: input.account_ref,
      grantId: request.proposer.grantId,
      proposedBy: request.proposer.actorDetail,
      idempotencyKey: input.idempotency_key ?? null,
      fingerprint: request.fingerprint,
      symbol: security.symbol,
      rawSymbol: security.rawSymbol,
      securityName: security.description,
      universalSymbolId: security.universalSymbolId,
      securityType: security.typeCode,
      currency: security.currency,
      exchange: security.exchange,
      side: input.side,
      quantity: input.quantity,
      orderType: input.order_type,
      limitPrice: input.limit_price ?? null,
      mode: request.user.mode,
      status: 'PROPOSED',
      policyVersion: request.policyVersion,
      expiresAt: request.expiresAt,
      createdAt: request.now,
      updatedAt: request.now,
      ...decisionColumns(request.evaluation, request.prefetched),
    })
    .returning({ id: orderIntents.id });
  if (inserted === undefined) {
    throw new Error('[Intents] intent insert returned no row');
  }
  await writeAudit(tx, {
    userId: request.userId,
    intentId: inserted.id,
    actor: request.proposer.actor,
    actorDetail: request.proposer.actorDetail,
    eventType: 'intent.proposed',
    details: {
      accountRef: input.account_ref,
      symbol: security.symbol,
      side: input.side,
      quantity: input.quantity,
      orderType: input.order_type,
      mode: request.user.mode,
    },
    createdAt: request.now,
  });
  return inserted.id;
}

// The locked half of a proposal: count, decide, record. Returns the intent id.
async function decideProposal(deps: Deps, request: DecideRequest): Promise<string> {
  return deps.db.transaction(async (tx) => {
    const user = await lockExistingUser(tx, request.userId);
    // Checked again under the lock: two retries with one key may arrive at the same moment.
    const existingId = await findIdempotentIntent(tx, request);
    if (existingId !== null) {
      return existingId;
    }
    const now = deps.now();
    const policy = await loadPolicy(tx, request.userId);
    const account = await loadDecisionAccount(tx, request.userId, request.input.account_ref);
    const counts = await dbCounts(tx, {
      userId: request.userId,
      now,
      policyCurrency: policy.rules.policyCurrency,
      accountRef: request.input.account_ref,
      symbol: request.security.symbol,
    });
    const context = buildPolicyContext({
      env: deps.env,
      user,
      account,
      hasTradeScope: await grantHasTradeScope(tx, request.userId),
      security: request.security,
      prefetched: request.prefetched,
      counts,
    });
    const evaluation = evaluate(policy.rules, orderFromInput(request.input, user.mode), context);
    const windowMs = policy.rules.approvalWindowMinutes * 60 * 1000;
    const intentId = await insertProposedIntent(tx, {
      ...request,
      user,
      evaluation,
      policyVersion: policy.version,
      // Only a pending intent can expire; a rejected one is final, so "now" is just a placeholder.
      expiresAt: new Date(now.getTime() + (evaluation.pass ? windowMs : 0)),
      now,
    });
    await applyTransition(tx, {
      intentId,
      userId: request.userId,
      from: 'PROPOSED',
      event: evaluation.pass ? 'POLICY_PASSED' : 'POLICY_FAILED',
      now,
      actor: request.proposer.actor,
      actorDetail: request.proposer.actorDetail,
      details: { failedRules: failedRules(evaluation) },
      set: evaluation.pass ? {} : { decidedAt: now },
    });
    return intentId;
  });
}

async function emailIfPending(deps: Deps, intent: IntentView): Promise<void> {
  if (intent.status !== 'PENDING_APPROVAL') {
    return;
  }
  const [recipient] = await deps.db
    .select({ email: users.email, emailVerified: users.emailVerified, isDemo: users.isDemo })
    .from(users)
    .where(eq(users.id, intent.userId));
  if (recipient === undefined || recipient.isDemo) {
    return;
  }
  // Fire and forget: a slow or failing email never delays or fails the proposal.
  sendApprovalEmail(deps, recipient, intent).catch((error: unknown) =>
    deps.logger.logError('[Intents] approval email failed', error, { intentId: intent.id }),
  );
}

async function rejectInput(
  deps: Deps,
  request: { userId: string; proposer: Proposer; reason: string; candidates: string[] },
): Promise<Extract<ProposeResult, { kind: 'invalid_input' }>> {
  await writeAudit(deps.db, {
    userId: request.userId,
    actor: request.proposer.actor,
    actorDetail: request.proposer.actorDetail,
    eventType: 'intent.input_rejected',
    details: { reason: request.reason },
    createdAt: deps.now(),
  });
  return { kind: 'invalid_input', reason: request.reason, candidates: request.candidates };
}

type Resolved =
  | { readonly kind: 'ready'; readonly security: ResolvedSecurity; readonly prefetched: Prefetched }
  | Exclude<ProposeResult, { kind: 'intent' }>;

// The network half: resolve the symbol, then fetch the price and holdings. No lock is held.
async function resolveAndPrefetch(
  deps: Deps,
  request: {
    userId: string;
    proposer: Proposer;
    input: ProposeOrderInput;
    snaptradeAccountId: string;
  },
): Promise<Resolved> {
  const { input, userId } = request;
  try {
    const resolution = await resolveSymbol(deps, userId, {
      snaptradeAccountId: request.snaptradeAccountId,
      ticker: input.symbol,
    });
    if (!resolution.ok) {
      return rejectInput(deps, {
        ...request,
        reason: resolution.reason,
        candidates: resolution.candidates,
      });
    }
    const prefetched = await prefetch(deps, {
      userId,
      snaptradeAccountId: request.snaptradeAccountId,
      side: input.side,
      orderType: input.order_type,
      limitPrice: input.limit_price ?? null,
      security: resolution.security,
    });
    return { kind: 'ready', security: resolution.security, prefetched };
  } catch (error) {
    return { kind: 'unavailable', reason: unavailableReason(deps, error, userId) };
  }
}

function intentResult(deps: Deps, intent: IntentView): ProposeResult {
  return { kind: 'intent', intent, approvalUrl: approvalUrlFor(deps.env.APP_BASE_URL, intent.id) };
}

// propose_order (V§4.3): validate, resolve, prefetch, then decide under the per-user lock.
// A policy rejection is a normal result (an intent in POLICY_REJECTED), not an error.
export async function proposeOrder(
  deps: Deps,
  request: { userId: string; proposer: Proposer; input: unknown },
): Promise<ProposeResult> {
  const parsed = ProposeOrderInputSchema.safeParse(request.input);
  if (!parsed.success) {
    return { kind: 'invalid_input', reason: describeInputProblem(parsed.error), candidates: [] };
  }
  const input = parsed.data;
  const fingerprint = orderFingerprint(input);
  const existingId = await findIdempotentIntent(deps.db, {
    userId: request.userId,
    input,
    fingerprint,
  });
  if (existingId !== null) {
    return intentResult(deps, await getIntent(deps, request.userId, existingId));
  }
  const account = await loadDecisionAccount(deps.db, request.userId, input.account_ref);
  if (account === null) {
    throw new NotFoundError(
      "We couldn't find that account. Use an account_ref from list_accounts.",
    );
  }
  const resolved = await resolveAndPrefetch(deps, {
    ...request,
    input,
    snaptradeAccountId: account.snaptradeAccountId,
  });
  if (resolved.kind !== 'ready') {
    return resolved;
  }
  const intentId = await decideProposal(deps, { ...request, input, fingerprint, ...resolved });
  const intent = await getIntent(deps, request.userId, intentId);
  await emailIfPending(deps, intent);
  return intentResult(deps, intent);
}
