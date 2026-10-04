import { and, eq } from 'drizzle-orm';
import type { Actor } from '../audit/write.js';
import type { Transaction } from '../db/client.js';
import { type LockedUser, lockExistingUser, lockIntentRow } from '../db/locks.js';
import { orderIntents } from '../db/schema.js';
import type { Deps } from '../deps.js';
import type { ApprovedIntent } from '../executors/executor.js';
import { paperExecutor } from '../executors/paper.js';
import { NotFoundError } from '../lib/errors.js';
import { type Evaluation, evaluate } from '../policy/evaluate.js';
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
import { decisionColumns, failedRules, getIntent, unavailableReason } from './service.js';
import type { ResolvedSecurity } from './symbols.js';
import { applyTransition, applyTransitionToMany } from './transitions.js';
import { type IntentView, requireIntentView } from './view.js';

// The human's decisions on a pending intent (V§4.4): approve, deny, or cancel. The AI can only
// cancel (cancel_order_intent); approving needs a signed-in session, a POST, and a CSRF token.

export type DecisionResult =
  | { readonly kind: 'intent'; readonly intent: IntentView }
  | { readonly kind: 'unavailable'; readonly reason: string; readonly intent: IntentView };

export type CancelResult =
  | { readonly kind: 'intent'; readonly intent: IntentView }
  | { readonly kind: 'cannot_cancel'; readonly reason: string; readonly intent: IntentView };

function securityOf(intent: IntentView): ResolvedSecurity {
  return {
    universalSymbolId: intent.universalSymbolId,
    symbol: intent.symbol,
    rawSymbol: intent.rawSymbol,
    description: intent.securityName,
    currency: intent.currency,
    exchange: intent.exchange,
    typeCode: intent.securityType,
  };
}

// The same evaluate() as at proposal time, with fresh data and today's counts excluding this
// intent (V§8.3). The order keeps the mode it was proposed in, so a mode switch fails the check.
async function recheck(
  tx: Transaction,
  deps: Deps,
  request: { user: LockedUser; intent: IntentView; prefetched: Prefetched; now: Date },
): Promise<Evaluation> {
  const { intent, user } = request;
  const policy = await loadPolicy(tx, user.id);
  const counts = await dbCounts(tx, {
    userId: user.id,
    now: request.now,
    policyCurrency: policy.rules.policyCurrency,
    accountRef: intent.accountRef,
    symbol: intent.symbol,
    excludeIntentId: intent.id,
  });
  const context = buildPolicyContext({
    env: deps.env,
    user,
    account: await loadDecisionAccount(tx, user.id, intent.accountRef),
    hasTradeScope: await grantHasTradeScope(tx, user.id),
    security: securityOf(intent),
    prefetched: request.prefetched,
    counts,
  });
  const order = {
    side: intent.side,
    quantity: intent.quantity,
    orderType: intent.orderType,
    limitPrice: intent.limitPrice ?? undefined,
    mode: intent.mode,
  };
  return evaluate(policy.rules, order, context);
}

function toApprovedIntent(intent: IntentView): ApprovedIntent {
  return {
    id: intent.id,
    userId: intent.userId,
    accountRef: intent.accountRef,
    symbol: intent.symbol,
    currency: intent.currency,
    side: intent.side,
    quantity: intent.quantity,
    orderType: intent.orderType,
    limitPrice: intent.limitPrice,
  };
}

// Paper runs inside the approval transaction, so EXECUTING is never left behind (V§10.2).
async function executeInPaper(
  tx: Transaction,
  request: { intent: IntentView; prefetched: Prefetched; now: Date },
): Promise<void> {
  // TODO(P13): live intents commit at EXECUTING and run the SnapTrade executor afterwards.
  if (request.intent.mode !== 'paper') {
    throw new Error('[Intents] only paper intents can be executed');
  }
  const result = await paperExecutor.execute(toApprovedIntent(request.intent), {
    tx,
    now: request.now,
    marketPrice: request.prefetched.marketPrice,
  });
  await applyTransition(tx, {
    intentId: request.intent.id,
    userId: request.intent.userId,
    from: 'EXECUTING',
    event: result.event,
    now: request.now,
    actor: 'system',
    actorDetail: 'paper',
    details: { filledQuantity: result.filledQuantity, note: result.note },
  });
}

// The locked half of an approval: still pending? → APPROVED → re-check → EXECUTING → fill.
async function approveWithFreshData(
  deps: Deps,
  intent: IntentView,
  prefetched: Prefetched,
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const user = await lockExistingUser(tx, intent.userId);
    const now = deps.now();
    await expireDue(tx, intent.userId, now);
    const locked = await lockIntentRow(tx, intent.userId, intent.id);
    // A second click, another tab, the kill switch, or expiry got here first: nothing to do.
    if (locked?.status !== 'PENDING_APPROVAL') {
      return;
    }
    const base = { intentId: intent.id, userId: intent.userId, now };
    await applyTransition(tx, {
      ...base,
      from: 'PENDING_APPROVAL',
      event: 'USER_APPROVED',
      actor: 'user',
    });
    const evaluation = await recheck(tx, deps, { user, intent, prefetched, now });
    const set = { ...decisionColumns(evaluation, prefetched), decidedAt: now };
    const details = { failedRules: failedRules(evaluation) };
    if (!evaluation.pass) {
      await applyTransition(tx, {
        ...base,
        from: 'APPROVED',
        event: 'RECHECK_FAILED',
        actor: 'system',
        details,
        set,
      });
      return;
    }
    await applyTransition(tx, {
      ...base,
      from: 'APPROVED',
      event: 'RECHECK_PASSED',
      actor: 'system',
      set,
    });
    await executeInPaper(tx, { intent, prefetched, now });
  });
}

// Approve (V§4.4): fresh price and holdings first (no lock held), then the locked re-check and
// execution. If SnapTrade can't be reached nothing changes: never approve on stale data.
export async function approveIntent(
  deps: Deps,
  request: { userId: string; intentId: string },
): Promise<DecisionResult> {
  const before = await getIntent(deps, request.userId, request.intentId);
  if (before.status !== 'PENDING_APPROVAL') {
    return { kind: 'intent', intent: before };
  }
  const account = await loadDecisionAccount(deps.db, request.userId, before.accountRef);
  if (account === null) {
    throw new NotFoundError();
  }
  let prefetched: Prefetched;
  try {
    prefetched = await prefetch(deps, {
      userId: request.userId,
      snaptradeAccountId: account.snaptradeAccountId,
      side: before.side,
      orderType: before.orderType,
      limitPrice: before.limitPrice,
      security: securityOf(before),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: unavailableReason(deps, error, request.userId),
      intent: before,
    };
  }
  await approveWithFreshData(deps, before, prefetched);
  return { kind: 'intent', intent: await getIntent(deps, request.userId, request.intentId) };
}

export async function denyIntent(
  deps: Deps,
  request: { userId: string; intentId: string },
): Promise<IntentView> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, request.userId);
    const now = deps.now();
    await expireDue(tx, request.userId, now);
    const locked = await lockIntentRow(tx, request.userId, request.intentId);
    if (locked?.status === 'PENDING_APPROVAL') {
      await applyTransition(tx, {
        intentId: request.intentId,
        userId: request.userId,
        from: 'PENDING_APPROVAL',
        event: 'USER_DENIED',
        now,
        actor: 'user',
        set: { decidedAt: now },
      });
    }
    return requireIntentView(tx, request.userId, request.intentId);
  });
}

// Only a pending intent can be cancelled. Cancelling an already-cancelled one is a no-op that
// returns it unchanged (idempotent, V§11.2).
export async function cancelIntent(
  deps: Deps,
  request: {
    userId: string;
    intentId: string;
    actor: Extract<Actor, 'ai' | 'user'>;
    actorDetail?: string;
  },
): Promise<CancelResult> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, request.userId);
    const now = deps.now();
    await expireDue(tx, request.userId, now);
    const locked = await lockIntentRow(tx, request.userId, request.intentId);
    if (locked?.status === 'PENDING_APPROVAL') {
      await applyTransition(tx, {
        intentId: request.intentId,
        userId: request.userId,
        from: 'PENDING_APPROVAL',
        event: 'CANCEL',
        now,
        actor: request.actor,
        actorDetail: request.actorDetail,
        set: { decidedAt: now },
      });
    }
    const intent = await requireIntentView(tx, request.userId, request.intentId);
    if (intent.status === 'CANCELLED') {
      return { kind: 'intent', intent };
    }
    return {
      kind: 'cannot_cancel',
      reason: `Can't cancel an order that is ${intent.status}. Only orders waiting for approval can be cancelled.`,
      intent,
    };
  });
}

// Cancels every PENDING_APPROVAL intent of the user (kill switch, disconnect, account deletion).
// The caller's transaction must hold the user's row lock. Returns how many were cancelled.
export async function cancelAllPending(
  tx: Transaction,
  request: { userId: string; now: Date; actor: Actor; reason: string },
): Promise<number> {
  const pending = await tx
    .select({ id: orderIntents.id })
    .from(orderIntents)
    .where(
      and(eq(orderIntents.userId, request.userId), eq(orderIntents.status, 'PENDING_APPROVAL')),
    )
    .for('update');
  const cancelled = await applyTransitionToMany(tx, {
    userId: request.userId,
    intentIds: pending.map((row) => row.id),
    from: 'PENDING_APPROVAL',
    event: 'CANCEL',
    now: request.now,
    actor: request.actor,
    details: { reason: request.reason },
  });
  return cancelled.length;
}
