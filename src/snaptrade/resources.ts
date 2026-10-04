import { z } from 'zod';
import type { Deps } from '../deps.js';
import { snaptradeFetch } from './api.js';

// Typed SnapTrade calls. Each response is checked with a Zod schema that lists only the fields
// we use; fields SnapTrade documents as nullable are accepted as null (V§5.2).

function parseResponse<T>(schema: z.ZodType<T>, data: unknown, route: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Only the route goes in the message: the body may contain account numbers.
    throw new Error(`[SnapTrade] ${route} response did not have the expected shape`);
  }
  return result.data;
}

const ConnectionSchema = z.object({
  id: z.string().min(1),
  brokerage: z.object({ name: z.string().nullish() }).nullish(),
  name: z.string().nullish(),
  type: z.string().nullish(),
  disabled: z.boolean(),
  disabled_date: z.string().nullish(),
});

export type SnapTradeConnection = {
  readonly id: string;
  readonly brokerageName: string;
  readonly type: 'read' | 'trade';
  readonly disabled: boolean;
  readonly disabledAt: Date | null;
};

export async function listConnections(deps: Deps, userId: string): Promise<SnapTradeConnection[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: '/authorizations',
    retry: 'read',
  });
  const connections = parseResponse(z.array(ConnectionSchema), data, 'GET /authorizations');
  return connections.map((connection) => ({
    id: connection.id,
    brokerageName: connection.brokerage?.name ?? connection.name ?? 'Unknown brokerage',
    // Documented values are `read` and `trade`; anything else is treated as read-only, the
    // safer reading for the live-trading gate.
    type: connection.type === 'trade' ? 'trade' : 'read',
    disabled: connection.disabled,
    disabledAt: connection.disabled_date == null ? null : new Date(connection.disabled_date),
  }));
}

const AccountSchema = z.object({
  id: z.guid(),
  brokerage_authorization: z.string().min(1),
  name: z.string().nullish(),
  number: z.string().nullish(),
  institution_name: z.string().nullish(),
  raw_type: z.string().nullish(),
  account_category: z.string().nullish(),
  is_paper: z.boolean().nullish(),
});

export type SnapTradeAccount = {
  readonly snaptradeAccountId: string;
  readonly connectionId: string;
  readonly name: string | null;
  readonly institutionName: string | null;
  // Only the last 4 characters ever leave this module; the full number is never stored.
  readonly numberLast4: string | null;
  readonly rawType: string | null;
  readonly accountCategory: string | null;
  readonly isPaper: boolean;
};

function lastFour(number: string | null | undefined): string | null {
  const trimmed = number?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(-4);
}

export async function listAccounts(deps: Deps, userId: string): Promise<SnapTradeAccount[]> {
  const data = await snaptradeFetch(deps, userId, {
    method: 'GET',
    path: '/accounts',
    retry: 'read',
  });
  const accounts = parseResponse(z.array(AccountSchema), data, 'GET /accounts');
  return accounts.map((account) => ({
    snaptradeAccountId: account.id,
    connectionId: account.brokerage_authorization,
    name: account.name ?? null,
    institutionName: account.institution_name ?? null,
    numberLast4: lastFour(account.number),
    rawType: account.raw_type ?? null,
    accountCategory: account.account_category ?? null,
    // Unknown counts as a real-money account, so the paper-accounts-only gate stays closed.
    isPaper: account.is_paper === true,
  }));
}
