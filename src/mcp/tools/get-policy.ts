import type { McpServer } from '@modelcontextprotocol/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema.js';
import { countToday } from '../../intents/context.js';
import { cmp, dec } from '../../lib/money.js';
import { describePolicy } from '../../policy/describe.js';
import { loadPolicy } from '../../settings/policy-store.js';
import {
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const OutputSchema = z.object({
  rules: z.array(z.string()),
  mode: z.enum(['paper', 'live']),
  kill_switch: z.boolean(),
  today: z.object({
    remaining_value: z.string(),
    remaining_orders: z.number().int(),
    currency: z.string(),
  }),
});

// Never below zero: a lowered limit can leave today already past it.
function remaining(limit: string, used: string): string {
  return cmp(used, limit) >= 0 ? '0' : dec(limit).minus(dec(used)).toFixed(2);
}

// Read-only: the AI can see the policy so it proposes valid orders, nothing more (V§8.5).
async function getPolicy(context: ToolContext) {
  const { deps, caller } = context;
  const [user] = await deps.db
    .select({ mode: users.mode, killSwitch: users.killSwitch })
    .from(users)
    .where(eq(users.id, caller.userId));
  if (user === undefined) {
    throw new Error('[MCP] verified token for a missing user');
  }
  const policy = await loadPolicy(deps.db, caller.userId);
  const today = await countToday(deps.db, {
    userId: caller.userId,
    now: deps.now(),
    policyCurrency: policy.rules.policyCurrency,
  });
  const rules = describePolicy(policy.rules, user);
  return toolResult(rules.join('\n'), {
    rules,
    mode: user.mode,
    kill_switch: user.killSwitch,
    today: {
      remaining_value: remaining(policy.rules.maxDailyValue, today.value),
      remaining_orders: Math.max(policy.rules.maxOrdersPerDay - today.orders, 0),
      currency: policy.rules.policyCurrency,
    },
  });
}

export function registerGetPolicyTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'get_policy',
    {
      title: 'Get the trading policy',
      description: describeTool(
        "Explains the user's trading rules in plain language, the mode (paper or live), the kill switch, and what is left of today's limits. Read it before proposing an order.",
      ),
      inputSchema: z.object({}).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    () => runTool(context, () => getPolicy(context)),
  );
}
