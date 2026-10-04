import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { cancelIntent } from '../../intents/decisions.js';
import { INTENT_STATES } from '../../intents/state-machine.js';
import {
  describeTool,
  IntentIdSchema,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const OutputSchema = z.object({
  intent_id: z.string(),
  status: z.enum(INTENT_STATES),
  cancelled: z.boolean(),
  message: z.string(),
});

// Cancelling an already-cancelled order returns it unchanged, so retries are safe. Any other
// state is a normal "can't cancel" result, not an error (V§11.2).
async function cancel(context: ToolContext, intentId: string) {
  const { deps, caller } = context;
  const result = await cancelIntent(deps, {
    userId: caller.userId,
    intentId,
    actor: 'ai',
    actorDetail: caller.clientHost,
  });
  const message =
    result.kind === 'intent' ? 'The order is cancelled. Nothing will be executed.' : result.reason;
  return toolResult(message, {
    intent_id: result.intent.id,
    status: result.intent.status,
    cancelled: result.kind === 'intent',
    message,
  });
}

export function registerCancelOrderIntentTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'cancel_order_intent',
    {
      title: 'Cancel a proposed order',
      description: describeTool(
        'Cancels a proposed order that is still waiting for approval. It cannot approve anything.',
      ),
      inputSchema: z.object({ intent_id: IntentIdSchema }).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: false, idempotent: true }),
    },
    ({ intent_id }) => runTool(context, () => cancel(context, intent_id)),
  );
}
