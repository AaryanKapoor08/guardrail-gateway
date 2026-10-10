import { and, desc, eq, inArray, like, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimResult, ClaimResultSchema } from '../claims/check-claims.js';
import type { DatabaseExecutor } from '../db/client.js';
import { accounts, executions, orderIntents } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { RULE_IDS } from '../policy/types.js';
import { type AiReasoning, AiReasoningSchema } from './propose-input.js';
import type { IntentState } from './state-machine.js';

// What the rest of the app (pages, MCP tools, email) sees of an intent: our own stored and
// resolved data and never SnapTrade ids. The one exception to "never AI-written text" (V§13
// prompt injection) is `aiReasoning`, which only the approval page's claim card shows, as plain
// text clearly labelled as the AI's own words (D30).

const CheckResultsSchema = z.array(
  z.object({ rule: z.enum(RULE_IDS), passed: z.boolean(), reason: z.string() }),
);

export type CheckResult = z.infer<typeof CheckResultsSchema>[number];

export type IntentView = {
  readonly id: string;
  readonly userId: string;
  readonly status: IntentState;
  readonly accountRef: string;
  readonly accountName: string;
  readonly institutionName: string;
  readonly accountNumberLast4: string | null;
  readonly accountRawType: string | null;
  readonly symbol: string;
  readonly rawSymbol: string | null;
  readonly securityName: string | null;
  readonly universalSymbolId: string;
  readonly exchange: string | null;
  readonly securityType: string;
  readonly currency: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: string;
  readonly orderType: 'market' | 'limit';
  readonly limitPrice: string | null;
  readonly timeInForce: string;
  readonly mode: 'paper' | 'live';
  readonly estPrice: string | null;
  readonly estValue: string | null;
  readonly priceSource: string;
  readonly priceAsOf: Date | null;
  readonly checkResults: CheckResult[];
  // Null for intents from before the claim check and for the user's own test proposals.
  readonly aiReasoning: AiReasoning | null;
  readonly claimResults: ClaimResult[] | null;
  readonly policyVersion: number;
  readonly fingerprint: string;
  readonly proposedBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly decidedAt: Date | null;
  readonly execution: {
    readonly filledQuantity: string;
    readonly avgFillPrice: string | null;
  } | null;
};

const viewColumns = {
  id: orderIntents.id,
  userId: orderIntents.userId,
  status: orderIntents.status,
  accountRef: orderIntents.accountId,
  accountName: accounts.name,
  institutionName: accounts.institutionName,
  accountNumberLast4: accounts.numberLast4,
  accountRawType: accounts.rawType,
  symbol: orderIntents.symbol,
  rawSymbol: orderIntents.rawSymbol,
  securityName: orderIntents.securityName,
  universalSymbolId: orderIntents.universalSymbolId,
  exchange: orderIntents.exchange,
  securityType: orderIntents.securityType,
  currency: orderIntents.currency,
  side: orderIntents.side,
  quantity: orderIntents.quantity,
  orderType: orderIntents.orderType,
  limitPrice: orderIntents.limitPrice,
  timeInForce: orderIntents.timeInForce,
  mode: orderIntents.mode,
  estPrice: orderIntents.estPrice,
  estValue: orderIntents.estValue,
  priceSource: orderIntents.priceSource,
  priceAsOf: orderIntents.priceAsOf,
  checkResults: orderIntents.checkResults,
  aiReasoning: orderIntents.aiReasoning,
  claimResults: orderIntents.claimResults,
  policyVersion: orderIntents.policyVersion,
  fingerprint: orderIntents.fingerprint,
  proposedBy: orderIntents.proposedBy,
  createdAt: orderIntents.createdAt,
  expiresAt: orderIntents.expiresAt,
  decidedAt: orderIntents.decidedAt,
  filledQuantity: executions.filledQuantity,
  avgFillPrice: executions.avgFillPrice,
};

function selectRows(db: DatabaseExecutor, where: SQL | undefined, limit: number) {
  return db
    .select(viewColumns)
    .from(orderIntents)
    .innerJoin(accounts, eq(accounts.id, orderIntents.accountId))
    .leftJoin(executions, eq(executions.intentId, orderIntents.id))
    .where(where)
    .orderBy(desc(orderIntents.createdAt))
    .limit(limit);
}

type ViewRow = Awaited<ReturnType<typeof selectRows>>[number];

const ClaimResultsSchema = z.array(ClaimResultSchema).nullable();

function toView(row: ViewRow): IntentView {
  const { filledQuantity, avgFillPrice, checkResults, aiReasoning, claimResults, ...rest } = row;
  const parsedResults = CheckResultsSchema.safeParse(checkResults);
  const parsedReasoning = AiReasoningSchema.nullable().safeParse(aiReasoning);
  const parsedClaims = ClaimResultsSchema.safeParse(claimResults);
  return {
    ...rest,
    checkResults: parsedResults.success ? parsedResults.data : [],
    aiReasoning: parsedReasoning.success ? parsedReasoning.data : null,
    claimResults: parsedClaims.success ? parsedClaims.data : null,
    execution: filledQuantity === null ? null : { filledQuantity, avgFillPrice },
  };
}

async function selectViews(
  db: DatabaseExecutor,
  where: SQL | undefined,
  limit: number,
): Promise<IntentView[]> {
  const rows = await selectRows(db, where, limit);
  return rows.map(toView);
}

// One intent, only if it belongs to the user (otherwise null: "not found", never "forbidden").
export async function loadIntentView(
  db: DatabaseExecutor,
  userId: string,
  intentId: string,
): Promise<IntentView | null> {
  if (!z.uuid().safeParse(intentId).success) {
    return null;
  }
  const [view] = await selectViews(
    db,
    and(eq(orderIntents.id, intentId), eq(orderIntents.userId, userId)),
    1,
  );
  return view ?? null;
}

export type IntentListOptions = {
  readonly limit: number;
  readonly statuses?: readonly IntentState[];
  // Only symbols starting with this text, e.g. "XEQT" finds "XEQT.TO".
  readonly symbolPrefix?: string;
};

// LIKE treats % and _ as wildcards; escaped, they only match themselves.
function startsWithPattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export function listIntentViews(
  db: DatabaseExecutor,
  userId: string,
  options: IntentListOptions,
): Promise<IntentView[]> {
  const statusFilter =
    options.statuses === undefined
      ? undefined
      : inArray(orderIntents.status, [...options.statuses]);
  const symbolFilter =
    options.symbolPrefix === undefined
      ? undefined
      : like(orderIntents.symbol, startsWithPattern(options.symbolPrefix));
  return selectViews(
    db,
    and(eq(orderIntents.userId, userId), statusFilter, symbolFilter),
    options.limit,
  );
}

export function approvalUrlFor(appBaseUrl: string, intentId: string): string {
  return `${appBaseUrl}/approvals/${intentId}`;
}

// "BUY 2 VFV.TO", used in email subjects and short summaries.
export function shortSummary(intent: Pick<IntentView, 'side' | 'quantity' | 'symbol'>): string {
  return `${intent.side.toUpperCase()} ${intent.quantity} ${intent.symbol}`;
}

export async function requireIntentView(
  db: DatabaseExecutor,
  userId: string,
  intentId: string,
): Promise<IntentView> {
  const view = await loadIntentView(db, userId, intentId);
  if (view === null) {
    throw new NotFoundError("We couldn't find that order.");
  }
  return view;
}

// How many OTHER pending intents have the same order details (V§8.4 duplicate warning).
export async function countDuplicatePending(
  db: DatabaseExecutor,
  intent: Pick<IntentView, 'id' | 'userId' | 'fingerprint'>,
): Promise<number> {
  const rows = await db
    .select({ id: orderIntents.id })
    .from(orderIntents)
    .where(
      and(
        eq(orderIntents.userId, intent.userId),
        eq(orderIntents.fingerprint, intent.fingerprint),
        eq(orderIntents.status, 'PENDING_APPROVAL'),
        ne(orderIntents.id, intent.id),
      ),
    );
  return rows.length;
}
