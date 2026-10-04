import type { Deps } from '../deps.js';
import { loadDecisionAccount } from '../intents/context.js';
import { NotFoundError } from '../lib/errors.js';

// The AI only ever sees accounts the user allowed that still exist (V§11.2). Anything else,
// including another user's account, is "not found".
export async function findAllowedAccount(
  deps: Deps,
  userId: string,
  accountRef: string,
): Promise<{ snaptradeAccountId: string }> {
  const account = await loadDecisionAccount(deps.db, userId, accountRef);
  if (account === null || !account.allowed || !account.present) {
    throw new NotFoundError(
      "We couldn't find that account among the ones the user allowed. Use an account_ref from list_accounts.",
    );
  }
  return { snaptradeAccountId: account.snaptradeAccountId };
}
