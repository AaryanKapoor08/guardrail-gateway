import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { NeedsReauthError, reconnectMessage } from '../../lib/errors.js';
import { cachedBalances } from '../../snaptrade/cached.js';
import { findAllowedAccount } from '../allowed-account.js';
import {
  AccountRefSchema,
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const OutputSchema = z.object({
  account_ref: z.string(),
  balances: z.array(
    z.object({
      currency: z.string(),
      cash: z.string().nullable(),
      buying_power: z.string().nullable(),
    }),
  ),
  reconnect_message: z.string().optional(),
});

async function getBalances(context: ToolContext, accountRef: string) {
  const { deps, caller } = context;
  const account = await findAllowedAccount(deps, caller.userId, accountRef);
  try {
    const balances = await cachedBalances(deps, caller.userId, account.snaptradeAccountId);
    const summary = balances
      .map((balance) => `${balance.currency}: cash ${balance.cash ?? 'unknown'}`)
      .join('; ');
    return toolResult(summary === '' ? 'No balances reported.' : summary, {
      account_ref: accountRef,
      balances: balances.map((balance) => ({
        currency: balance.currency,
        cash: balance.cash,
        buying_power: balance.buyingPower,
      })),
    });
  } catch (error) {
    if (!(error instanceof NeedsReauthError)) {
      throw error;
    }
    // Handled: the MCP token is fine; only the SnapTrade sign-in needs renewing (V§11.2).
    const message = reconnectMessage(deps.env.APP_BASE_URL);
    return toolResult(message, {
      account_ref: accountRef,
      balances: [],
      reconnect_message: message,
    });
  }
}

export function registerGetBalancesTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get_balances',
    {
      title: 'Get balances',
      description: describeTool(
        'Shows cash per currency (and buying power when the broker reports it) for one allowed account.',
      ),
      inputSchema: z.object({ account_ref: AccountRefSchema }).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    ({ account_ref }) => runTool(context, () => getBalances(context, account_ref)),
  );
}
