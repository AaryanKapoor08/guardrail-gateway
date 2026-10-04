import type { McpServer } from '@modelcontextprotocol/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema.js';
import { listPaperPositions } from '../../executors/paper.js';
import { NeedsReauthError, reconnectMessage } from '../../lib/errors.js';
import { mul, roundCents } from '../../lib/money.js';
import { cachedPositions } from '../../snaptrade/cached.js';
import type { Holding } from '../../snaptrade/resources.js';
import { findAllowedAccount } from '../allowed-account.js';
import {
  AccountRefSchema,
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const PositionSchema = z.object({
  symbol: z.string(),
  quantity: z.string(),
  price: z.string().nullable(),
  value: z.string().nullable(),
  currency: z.string().nullable(),
  // "broker": held at the real brokerage. "paper": a simulated change from approved paper orders.
  source: z.enum(['broker', 'paper']),
});

const OutputSchema = z.object({
  account_ref: z.string(),
  positions: z.array(PositionSchema),
  other_holdings_count: z.number().int(),
  reconnect_message: z.string().optional(),
});

type Position = z.infer<typeof PositionSchema>;

function fromBroker(holding: Holding): Position {
  return {
    symbol: holding.symbol,
    quantity: holding.units,
    price: holding.price,
    value: holding.price === null ? null : roundCents(mul(holding.units, holding.price)),
    currency: holding.currency,
    source: 'broker',
  };
}

async function paperPositions(context: ToolContext, accountRef: string): Promise<Position[]> {
  const { deps, caller } = context;
  const [user] = await deps.db
    .select({ mode: users.mode })
    .from(users)
    .where(eq(users.id, caller.userId));
  if (user?.mode !== 'paper') {
    return [];
  }
  const all = await listPaperPositions(deps.db, caller.userId);
  return all
    .filter((position) => position.accountRef === accountRef)
    .map((position) => ({
      symbol: position.symbol,
      quantity: position.quantity,
      // The average simulated fill price.
      price: position.avgCost,
      value: roundCents(mul(position.quantity, position.avgCost)),
      currency: position.currency,
      source: 'paper',
    }));
}

async function getPositions(context: ToolContext, accountRef: string) {
  const { deps, caller } = context;
  const account = await findAllowedAccount(deps, caller.userId, accountRef);
  const paper = await paperPositions(context, accountRef);
  try {
    const broker = await cachedPositions(deps, caller.userId, account.snaptradeAccountId);
    const positions = [...broker.holdings.map(fromBroker), ...paper];
    return toolResult(`${positions.length} position(s) in ${accountRef}.`, {
      account_ref: accountRef,
      positions,
      other_holdings_count: broker.otherCount,
    });
  } catch (error) {
    if (!(error instanceof NeedsReauthError)) {
      throw error;
    }
    // Handled: the MCP token is fine; only the SnapTrade sign-in needs renewing (V§11.2).
    const message = reconnectMessage(deps.env.APP_BASE_URL);
    return toolResult(message, {
      account_ref: accountRef,
      positions: paper,
      other_holdings_count: 0,
      reconnect_message: message,
    });
  }
}

export function registerGetPositionsTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get_positions',
    {
      title: 'Get positions',
      description: describeTool(
        'Shows the stocks and ETFs held in one allowed account (other holdings are only counted). In paper mode it also lists simulated paper positions, labelled source "paper".',
      ),
      inputSchema: z.object({ account_ref: AccountRefSchema }).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    ({ account_ref }) => runTool(context, () => getPositions(context, account_ref)),
  );
}
