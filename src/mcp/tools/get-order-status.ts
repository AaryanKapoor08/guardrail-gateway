import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getIntent } from '../../intents/service.js';
import { describeIntentForAi, IntentDtoSchema, toIntentDto } from '../intent-dto.js';
import {
  describeTool,
  IntentIdSchema,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

async function getOrderStatus(context: ToolContext, intentId: string) {
  const intent = toIntentDto(
    context.deps.env,
    await getIntent(context.deps, context.caller.userId, intentId),
  );
  return toolResult(describeIntentForAi(intent), intent);
}

export function registerGetOrderStatusTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get_order_status',
    {
      title: 'Get order status',
      description: describeTool(
        'Shows the current status of a proposed order: waiting for approval, rejected (with the reasons), expired, cancelled, or filled (with fill details).',
      ),
      inputSchema: z.object({ intent_id: IntentIdSchema }).strict(),
      outputSchema: IntentDtoSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    ({ intent_id }) => runTool(context, () => getOrderStatus(context, intent_id)),
  );
}
