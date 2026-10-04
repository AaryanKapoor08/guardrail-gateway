import { and, asc, eq, sql } from 'drizzle-orm';
import type { DatabaseExecutor, Transaction } from '../db/client.js';
import { accounts, executions, paperCash, paperPositions } from '../db/schema.js';
import { cmp, dec, mul, roundCents } from '../lib/money.js';
import type { ApprovedIntent, ExecutionContext, ExecutionResult, Executor } from './executor.js';

// Paper (simulated) trading, the default (V§10.2). Nothing is sent to a broker; fills are
// recorded in our own ledger at the fresh approval-time price.

const AVG_COST_DECIMAL_PLACES = 8;

// Market orders always fill. A limit buy fills if the price is at or below the limit; a limit
// sell if it is at or above. Paper mode doesn't simulate orders that wait for the price to move.
export function isMarketable(intent: ApprovedIntent, price: string): boolean {
  if (intent.orderType === 'market' || intent.limitPrice === null) {
    return true;
  }
  const comparison = cmp(price, intent.limitPrice);
  return intent.side === 'buy' ? comparison <= 0 : comparison >= 0;
}

function positionKey(intent: ApprovedIntent) {
  return and(
    eq(paperPositions.userId, intent.userId),
    eq(paperPositions.accountId, intent.accountRef),
    eq(paperPositions.symbol, intent.symbol),
  );
}

// Buys: new average cost = (old quantity × old average + quantity × price) / new quantity.
// Sells reduce the quantity and keep the average. The paper quantity may go below zero: that is
// a simulated sale of shares held at the real broker (held = real + paper, V§8.2 rule 6).
async function updatePaperPosition(
  tx: Transaction,
  intent: ApprovedIntent,
  price: string,
): Promise<void> {
  const [existing] = await tx
    .select({ quantity: paperPositions.quantity, avgCost: paperPositions.avgCost })
    .from(paperPositions)
    .where(positionKey(intent));
  const oldQuantity = dec(existing?.quantity ?? '0');
  const oldAvgCost = dec(existing?.avgCost ?? price);
  const signedQuantity = intent.side === 'buy' ? dec(intent.quantity) : dec(intent.quantity).neg();
  const newQuantity = oldQuantity.plus(signedQuantity);
  if (newQuantity.eq(0)) {
    await tx.delete(paperPositions).where(positionKey(intent));
    return;
  }
  const avgCost =
    intent.side === 'buy'
      ? oldQuantity.times(oldAvgCost).plus(signedQuantity.times(price)).div(newQuantity)
      : oldAvgCost;
  const values = {
    quantity: newQuantity.toFixed(),
    avgCost: avgCost.round(AVG_COST_DECIMAL_PLACES).toFixed(),
  };
  await tx
    .insert(paperPositions)
    .values({
      userId: intent.userId,
      accountId: intent.accountRef,
      symbol: intent.symbol,
      currency: intent.currency,
      ...values,
    })
    .onConflictDoUpdate({
      target: [paperPositions.userId, paperPositions.accountId, paperPositions.symbol],
      set: values,
    });
}

// A running "cash change" per currency: buys spend, sells receive. No buying-power check in v1;
// the policy limits are the guardrail (V§10.2).
async function updatePaperCash(tx: Transaction, intent: ApprovedIntent, value: string) {
  const change = intent.side === 'buy' ? dec(value).neg().toFixed() : value;
  await tx
    .insert(paperCash)
    .values({
      userId: intent.userId,
      accountId: intent.accountRef,
      currency: intent.currency,
      cashChange: change,
    })
    .onConflictDoUpdate({
      target: [paperCash.userId, paperCash.accountId, paperCash.currency],
      set: { cashChange: sql`${paperCash.cashChange} + excluded.cash_change` },
    });
}

async function recordExecution(
  context: ExecutionContext,
  intent: ApprovedIntent,
  result: ExecutionResult,
): Promise<void> {
  await context.tx.insert(executions).values({
    intentId: intent.id,
    executor: 'paper',
    filledQuantity: result.filledQuantity,
    avgFillPrice: result.avgFillPrice,
    brokerStatus: null,
    result: { note: result.note },
    updatedAt: context.now,
  });
}

async function closeUnfilled(
  context: ExecutionContext,
  intent: ApprovedIntent,
  note: string,
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    event: 'PAPER_NOT_MARKETABLE',
    filledQuantity: '0',
    avgFillPrice: null,
    note,
  };
  await recordExecution(context, intent, result);
  return result;
}

async function execute(
  intent: ApprovedIntent,
  context: ExecutionContext,
): Promise<ExecutionResult> {
  const price = context.marketPrice;
  if (price === null) {
    return closeUnfilled(context, intent, 'No market price at approval time to simulate a fill.');
  }
  if (!isMarketable(intent, price)) {
    return closeUnfilled(
      context,
      intent,
      "Not marketable at approval time; paper mode doesn't simulate resting orders.",
    );
  }
  await updatePaperPosition(context.tx, intent, price);
  await updatePaperCash(context.tx, intent, roundCents(mul(intent.quantity, price)));
  const result: ExecutionResult = {
    event: 'PAPER_FILLED',
    filledQuantity: intent.quantity,
    avgFillPrice: price,
    note: 'Simulated fill at the approval-time price.',
  };
  await recordExecution(context, intent, result);
  return result;
}

export const paperExecutor: Executor = { execute };

export type PaperPosition = {
  readonly accountRef: string;
  readonly accountName: string;
  readonly symbol: string;
  readonly quantity: string;
  readonly avgCost: string;
  readonly currency: string;
};

export function listPaperPositions(db: DatabaseExecutor, userId: string): Promise<PaperPosition[]> {
  return db
    .select({
      accountRef: paperPositions.accountId,
      accountName: accounts.name,
      symbol: paperPositions.symbol,
      quantity: paperPositions.quantity,
      avgCost: paperPositions.avgCost,
      currency: paperPositions.currency,
    })
    .from(paperPositions)
    .innerJoin(accounts, eq(accounts.id, paperPositions.accountId))
    .where(eq(paperPositions.userId, userId))
    .orderBy(asc(accounts.name), asc(paperPositions.symbol));
}
