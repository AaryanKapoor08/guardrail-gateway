import { eq } from 'drizzle-orm';
import type { DatabaseExecutor } from '../db/client.js';
import { policies } from '../db/schema.js';
import { type PolicyRules, PolicyRulesSchema } from '../policy/schema.js';

// Reading the user's stored policy. Lives outside src/policy because that folder is pure code
// with no database access (P7).

export type StoredPolicy = { readonly rules: PolicyRules; readonly version: number };

// Every read is validated, so a bad stored value can never reach the policy engine.
export async function loadPolicy(db: DatabaseExecutor, userId: string): Promise<StoredPolicy> {
  const [row] = await db
    .select({ rules: policies.rules, version: policies.version })
    .from(policies)
    .where(eq(policies.userId, userId));
  if (row === undefined) {
    throw new Error('[Policy] user has no policy row');
  }
  const parsed = PolicyRulesSchema.safeParse(row.rules);
  if (!parsed.success) {
    throw new Error('[Policy] stored policy failed validation');
  }
  return { rules: parsed.data, version: row.version };
}
