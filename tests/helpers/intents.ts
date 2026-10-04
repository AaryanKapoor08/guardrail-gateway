import { and, eq, inArray, like } from 'drizzle-orm';
import {
  accounts,
  auditEvents,
  executions,
  orderIntents,
  paperPositions,
  policies,
} from '../../src/db/schema.js';
import { type ProposeResult, type Proposer, proposeOrder } from '../../src/intents/service.js';
import type { IntentView } from '../../src/intents/view.js';
import { DEFAULT_POLICY, type PolicyRules } from '../../src/policy/schema.js';
import type { TestApp } from './app.js';
import { TFSA_ACCOUNT_ID } from './snaptrade-data.js';

// Small builders for the intent tests: allow an account, change the policy, propose an order.

export const AI_PROPOSER: Proposer = { actor: 'ai', actorDetail: 'claude.ai', grantId: null };

// Marks one of the user's synced accounts as allowed (as the dashboard toggle would) and
// returns its account_ref.
export async function allowAccount(
  testApp: TestApp,
  userId: string,
  snaptradeAccountId: string = TFSA_ACCOUNT_ID,
): Promise<string> {
  const [row] = await testApp.deps.db
    .update(accounts)
    .set({ allowed: true })
    .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, snaptradeAccountId)))
    .returning({ id: accounts.id });
  if (row === undefined) {
    throw new Error('test setup: account not synced');
  }
  return row.id;
}

// The account_ref of a synced account, without changing it (new accounts are not allowed).
export async function findAccountRef(
  testApp: TestApp,
  userId: string,
  snaptradeAccountId: string,
): Promise<string> {
  const [row] = await testApp.deps.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.snaptradeAccountId, snaptradeAccountId)));
  if (row === undefined) {
    throw new Error('test setup: account not synced');
  }
  return row.id;
}

export async function updatePolicy(
  testApp: TestApp,
  userId: string,
  overrides: Partial<PolicyRules>,
): Promise<void> {
  await testApp.deps.db
    .update(policies)
    .set({ rules: { ...DEFAULT_POLICY, ...overrides } })
    .where(eq(policies.userId, userId));
}

export type OrderInput = {
  account_ref: string;
  symbol?: string;
  side?: 'buy' | 'sell';
  quantity?: string | number;
  order_type?: 'market' | 'limit';
  limit_price?: string;
  idempotency_key?: string;
};

// Buys 1 XEQT.TO at market by default (about $32 CAD: inside the default $100 limit).
export function proposeTestOrder(
  testApp: TestApp,
  userId: string,
  input: OrderInput,
): Promise<ProposeResult> {
  return proposeOrder(testApp.deps, {
    userId,
    proposer: AI_PROPOSER,
    input: { symbol: 'XEQT.TO', side: 'buy', quantity: '1', order_type: 'market', ...input },
  });
}

export function expectIntent(result: ProposeResult): IntentView {
  if (result.kind !== 'intent') {
    throw new Error(`expected an intent, got ${result.kind}: ${result.reason}`);
  }
  return result.intent;
}

export async function intentStatus(testApp: TestApp, intentId: string): Promise<string | null> {
  const [row] = await testApp.deps.db
    .select({ status: orderIntents.status })
    .from(orderIntents)
    .where(eq(orderIntents.id, intentId));
  return row?.status ?? null;
}

export async function countIntents(testApp: TestApp): Promise<number> {
  const rows = await testApp.deps.db.select({ id: orderIntents.id }).from(orderIntents);
  return rows.length;
}

export async function listExecutions(testApp: TestApp, intentIds: string[]) {
  return testApp.deps.db
    .select({
      intentId: executions.intentId,
      filledQuantity: executions.filledQuantity,
      avgFillPrice: executions.avgFillPrice,
    })
    .from(executions)
    .where(inArray(executions.intentId, intentIds));
}

export async function paperQuantity(
  testApp: TestApp,
  request: { userId: string; symbol: string },
): Promise<string | null> {
  const [row] = await testApp.deps.db
    .select({ quantity: paperPositions.quantity })
    .from(paperPositions)
    .where(
      and(eq(paperPositions.userId, request.userId), eq(paperPositions.symbol, request.symbol)),
    );
  return row?.quantity ?? null;
}

// The `intent.*` audit event types written for one intent, oldest first.
export async function intentAuditTrail(testApp: TestApp, intentId: string): Promise<string[]> {
  const rows = await testApp.deps.db
    .select({ eventType: auditEvents.eventType })
    .from(auditEvents)
    .where(and(eq(auditEvents.intentId, intentId), like(auditEvents.eventType, 'intent.%')))
    .orderBy(auditEvents.id);
  return rows.map((row) => row.eventType);
}
