import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ProposeOrderInputSchema } from '../../intents/propose-input.js';
import { proposeOrder } from '../../intents/service.js';
import { INTENT_STATES } from '../../intents/state-machine.js';
import { describeIntentForAi, IntentDtoSchema, toIntentDto } from '../intent-dto.js';
import {
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolError,
  toolResult,
} from '../tool-kit.js';

// The intent fields when one was created, or INVALID_INPUT / UNAVAILABLE with a reason.
const OutputSchema = IntentDtoSchema.partial().extend({
  status: z.enum([...INTENT_STATES, 'INVALID_INPUT', 'UNAVAILABLE']),
  reason: z.string().optional(),
  candidates: z.array(z.string()).optional(),
});

const TOO_MANY_PROPOSALS =
  'Too many orders proposed in the last minute (the limit is 10). Wait a minute and try again.';

async function propose(context: ToolContext, input: z.infer<typeof ProposeOrderInputSchema>) {
  const { deps, caller } = context;
  if (!deps.limiters.proposalsPerUser.allowRequest(caller.userId)) {
    return toolError(TOO_MANY_PROPOSALS);
  }
  const result = await proposeOrder(deps, {
    userId: caller.userId,
    proposer: { actor: 'ai', actorDetail: caller.clientHost, grantId: caller.grantId },
    input,
  });
  if (result.kind === 'invalid_input') {
    const candidates =
      result.candidates.length === 0 ? '' : ` Candidates: ${result.candidates.join(', ')}.`;
    return toolResult(`${result.reason}${candidates}`, {
      status: 'INVALID_INPUT',
      reason: result.reason,
      candidates: result.candidates,
    });
  }
  if (result.kind === 'unavailable') {
    return toolResult(result.reason, { status: 'UNAVAILABLE', reason: result.reason });
  }
  const intent = toIntentDto(deps.env, result.intent);
  return toolResult(describeIntentForAi(intent), intent);
}

export function registerProposeOrderTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'propose_order',
    {
      title: 'Propose an order',
      description: describeTool(
        "Proposes a stock or ETF order in an allowed account. The user's policy checks it at once; if it passes, the result has an approval_url the user must open to approve it. Always include reasoning: why you are placing the order, the price per share you expect, the company or fund you believe the symbol is, the user's own words, and any web pages you used. The gateway checks your expected price and company against the broker's data and shows the user any difference; claim_check in the result tells you what didn't match. Always submit the order the user asked for: the gateway enforces the user's rules, so don't refuse an order because you guess it might break them. Always send a new idempotency_key (a UUID) and reuse it when retrying the same order. Quantities and prices may be numbers or decimal strings.",
      ),
      inputSchema: ProposeOrderInputSchema,
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: false, idempotent: false }),
    },
    (input) => runTool(context, () => propose(context, input)),
  );
}
