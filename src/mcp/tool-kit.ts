import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { SnapTradeApiError } from '../snaptrade/api.js';

// Shared pieces for the MCP tools (V§11.2): who is calling, the result shapes, and one wrapper
// that applies the rate limit and turns unexpected failures into a safe message for the AI.

// The user and AI app behind this request. Comes only from our verified token (authInfo.extra),
// never from tool input.
export const McpCallerSchema = z.object({
  userId: z.uuid(),
  grantId: z.uuid(),
  clientHost: z.string().min(1),
});

export type McpCaller = z.infer<typeof McpCallerSchema>;

export type ToolContext = { readonly deps: Deps; readonly caller: McpCaller };

// Ends every tool description (V§11.2).
export const HUMAN_APPROVAL_SENTENCE =
  'Orders always require the human to approve them on the Guardrail Gateway website. This tool cannot approve, change limits, or switch to live trading.';

export function describeTool(purpose: string): string {
  return `${purpose} ${HUMAN_APPROVAL_SENTENCE}`;
}

export function toolAnnotations(hints: {
  readOnly: boolean;
  idempotent: boolean;
}): ToolAnnotations {
  return {
    readOnlyHint: hints.readOnly,
    destructiveHint: false,
    idempotentHint: hints.idempotent,
    openWorldHint: false,
  };
}

export const AccountRefSchema = z
  .string()
  .regex(/^acc_[A-Za-z0-9_-]+$/, 'must be an account_ref from list_accounts, like acc_7Kq2x9Ab');

export const IntentIdSchema = z.uuid('must be an intent_id returned by propose_order');

// A normal result: a short summary for the AI to read plus the structured data.
export function toolResult(summary: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: summary }], structuredContent: structured };
}

// Only invalid input and system failures are errors; business outcomes are normal results.
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const TOO_MANY_CALLS = 'Too many requests in the last minute. Wait a minute and try again.';
const BROKER_UNAVAILABLE =
  "Couldn't get data from the user's broker right now. Try again in a minute.";
const SOMETHING_WENT_WRONG = 'Something went wrong on our side. Try again in a minute.';

// Runs one tool call: the per-user limit first (V§11.1), then the tool. Expected problems
// become their plain message; anything else is logged and hidden behind a generic message, so
// no internal detail ever reaches the AI.
export async function runTool(
  context: ToolContext,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const { deps, caller } = context;
  if (!deps.limiters.toolCallsPerUser.allowRequest(caller.userId)) {
    return toolError(TOO_MANY_CALLS);
  }
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) {
      return toolError(error.message);
    }
    if (error instanceof SnapTradeApiError) {
      deps.logger.logError('[MCP] SnapTrade read failed', error, { userId: caller.userId });
      return toolError(BROKER_UNAVAILABLE);
    }
    deps.logger.logError('[MCP] tool failed', error, { userId: caller.userId });
    return toolError(SOMETHING_WENT_WRONG);
  }
}

export function isoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}
