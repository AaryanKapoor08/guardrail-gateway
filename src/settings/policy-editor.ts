import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { writeAudit } from '../audit/write.js';
import { lockExistingUser } from '../db/locks.js';
import { policies } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { hasOpenIntents } from '../intents/context.js';
import { type PolicyRules, PolicyRulesSchema } from '../policy/schema.js';
import { loadPolicy } from './policy-store.js';

// Editing the policy (V§8.5): only in the web UI, signed in, with CSRF. Every save bumps the
// version and audits the rules before and after. Intents keep the version they were checked
// against.

// The form's raw values. They are strings (or checked boxes) until the policy schema checks them.
export type PolicyFormValues = {
  readonly allowedSides: readonly string[];
  readonly maxOrderValue: string;
  readonly maxDailyValue: string;
  readonly maxOrdersPerDay: string;
  readonly symbolAllowlist: string;
  readonly symbolDenylist: string;
  readonly policyCurrency: string;
  readonly approvalWindowMinutes: string;
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  allowedSides: 'Allowed actions',
  maxOrderValue: 'Per-order limit',
  maxDailyValue: 'Daily limit',
  maxOrdersPerDay: 'Orders per day',
  symbolAllowlist: 'Allowed symbols',
  symbolDenylist: 'Blocked symbols',
  policyCurrency: 'Currency',
  approvalWindowMinutes: 'Approval window',
};

export function policyToFormValues(rules: PolicyRules): PolicyFormValues {
  return {
    allowedSides: rules.allowedSides,
    maxOrderValue: rules.maxOrderValue,
    maxDailyValue: rules.maxDailyValue,
    maxOrdersPerDay: String(rules.maxOrdersPerDay),
    symbolAllowlist: rules.symbolAllowlist.join(', '),
    symbolDenylist: rules.symbolDenylist.join(', '),
    policyCurrency: rules.policyCurrency,
    approvalWindowMinutes: String(rules.approvalWindowMinutes),
  };
}

// "VFV.TO, xeqt.to" -> ["VFV.TO", "XEQT.TO"]. The schema uppercases and validates each one.
function splitSymbols(text: string): string[] {
  return text
    .split(',')
    .map((symbol) => symbol.trim())
    .filter((symbol) => symbol !== '');
}

// Blank number fields stay blank text, so the schema reports them instead of reading 0.
function toNumber(text: string): number | string {
  return text.trim() === '' ? text : Number(text);
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const field = String(issue.path[0] ?? '');
    return `${FIELD_LABELS[field] ?? 'Policy'}: ${issue.message}`;
  });
}

export type PolicyCheck =
  | { readonly ok: true; readonly rules: PolicyRules }
  | { readonly ok: false; readonly problems: string[] };

// The fixed rules (asset types, order types, schema version) come from the current policy.
export function rulesFromForm(current: PolicyRules, values: PolicyFormValues): PolicyCheck {
  const parsed = PolicyRulesSchema.safeParse({
    ...current,
    allowedSides: values.allowedSides,
    maxOrderValue: values.maxOrderValue,
    maxDailyValue: values.maxDailyValue,
    maxOrdersPerDay: toNumber(values.maxOrdersPerDay),
    symbolAllowlist: splitSymbols(values.symbolAllowlist),
    symbolDenylist: splitSymbols(values.symbolDenylist),
    policyCurrency: values.policyCurrency,
    approvalWindowMinutes: toNumber(values.approvalWindowMinutes),
  });
  return parsed.success
    ? { ok: true, rules: parsed.data }
    : { ok: false, problems: describeIssues(parsed.error) };
}

const CURRENCY_LOCKED =
  'Currency: it can only change when no orders are open (waiting for approval or executing). Cancel or finish them first.';

export async function savePolicy(
  deps: Deps,
  request: { userId: string; values: PolicyFormValues },
): Promise<PolicyCheck> {
  return deps.db.transaction(async (tx) => {
    await lockExistingUser(tx, request.userId);
    const current = await loadPolicy(tx, request.userId);
    const checked = rulesFromForm(current.rules, request.values);
    if (!checked.ok) {
      return checked;
    }
    // Daily totals only sum the current currency, so a switch with open orders would let them
    // escape the new budget (V§8.3).
    const isCurrencyChange = checked.rules.policyCurrency !== current.rules.policyCurrency;
    if (isCurrencyChange && (await hasOpenIntents(tx, request.userId))) {
      return { ok: false, problems: [CURRENCY_LOCKED] };
    }
    const now = deps.now();
    const version = current.version + 1;
    await tx
      .update(policies)
      .set({ rules: checked.rules, version, updatedAt: now })
      .where(eq(policies.userId, request.userId));
    await writeAudit(tx, {
      userId: request.userId,
      actor: 'user',
      eventType: 'policy.updated',
      details: { version, before: current.rules, after: checked.rules },
      createdAt: now,
    });
    return checked;
  });
}
