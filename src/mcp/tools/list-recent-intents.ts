import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { listRecentIntents } from '../../intents/service.js';
import { INTENT_STATES } from '../../intents/state-machine.js';
import {
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const OutputSchema = z.object({
  intents: z.array(
    z.object({
      intent_id: z.string(),
      created_at: z.string(),
      symbol: z.string(),
      side: z.enum(['buy', 'sell']),
      quantity: z.string(),
      status: z.enum(INTENT_STATES),
    }),
  ),
});

async function listIntents(context: ToolContext, limit: number) {
  const intents = await listRecentIntents(context.deps, context.caller.userId, { limit });
  const rows = intents.map((intent) => ({
    intent_id: intent.id,
    created_at: intent.createdAt.toISOString(),
    symbol: intent.symbol,
    side: intent.side,
    quantity: intent.quantity,
    status: intent.status,
  }));
  return toolResult(`${rows.length} recent order(s).`, { intents: rows });
}

export function registerListRecentIntentsTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'list_recent_intents',
    {
      title: 'List recent orders',
      description: describeTool('Lists the most recent proposed orders, newest first.'),
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    ({ limit }) => runTool(context, () => listIntents(context, limit)),
  );
}
