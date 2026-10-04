import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type AccountListItem, listUserAccounts } from '../../accounts/service.js';
import {
  describeTool,
  runTool,
  type ToolContext,
  toolAnnotations,
  toolResult,
} from '../tool-kit.js';

const AccountSchema = z.object({
  account_ref: z.string(),
  institution: z.string(),
  name: z.string(),
  raw_type: z.string().nullable(),
  category: z.string().nullable(),
  number_last4: z.string().nullable(),
  is_paper: z.boolean(),
  connection_status: z.enum(['healthy', 'disabled']),
});

const OutputSchema = z.object({ accounts: z.array(AccountSchema) });

function toAccount(account: AccountListItem): z.infer<typeof AccountSchema> {
  return {
    account_ref: account.ref,
    institution: account.institutionName,
    name: account.name,
    raw_type: account.rawType,
    category: account.accountCategory,
    number_last4: account.numberLast4,
    is_paper: account.isPaper,
    connection_status: account.connectionDisabled ? 'disabled' : 'healthy',
  };
}

// Only accounts the user allowed and that still exist at SnapTrade (V§11.2).
export function registerListAccountsTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'list_accounts',
    {
      title: 'List allowed accounts',
      description: describeTool(
        'Lists the brokerage accounts the user allowed Guardrail Gateway to use, with the account_ref to pass to other tools.',
      ),
      inputSchema: z.object({}).strict(),
      outputSchema: OutputSchema,
      annotations: toolAnnotations({ readOnly: true, idempotent: true }),
    },
    () =>
      runTool(context, async () => {
        const all = await listUserAccounts(context.deps, context.caller.userId);
        const accounts = all.filter((account) => account.allowed && account.present).map(toAccount);
        const summary =
          accounts.length === 0
            ? 'No accounts are allowed yet. Ask the user to allow one on the Guardrail Gateway dashboard.'
            : `${accounts.length} allowed account(s): ${accounts.map((a) => `${a.name} (${a.account_ref})`).join(', ')}.`;
        return toolResult(summary, { accounts });
      }),
  );
}
