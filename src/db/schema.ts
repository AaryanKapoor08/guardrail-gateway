import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// The full data model from PRODUCT_VISION §14.1. Columns marked "null" there are nullable;
// every other column is NOT NULL. Money and quantities are `numeric` (strings in TypeScript).

export const MODES = ['paper', 'live'] as const;
export const CONNECTION_TYPES = ['read', 'trade'] as const;
export const MCP_TOKEN_KINDS = ['access', 'refresh'] as const;
export const SIDES = ['buy', 'sell'] as const;
export const ORDER_TYPES = ['market', 'limit'] as const;
export const EXECUTORS = ['paper', 'snaptrade'] as const;
export const ACTORS = ['ai', 'user', 'system'] as const;
export const INTENT_STATUSES = [
  'PROPOSED',
  'POLICY_REJECTED',
  'PENDING_APPROVAL',
  'DENIED',
  'EXPIRED',
  'CANCELLED',
  'APPROVED',
  'EXECUTING',
  'SUBMITTED',
  'UNKNOWN',
  'FILLED',
  'CLOSED',
  'FAILED',
] as const;

function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true });
}

// Builds `column in ('a', 'b')` for a check constraint. DDL can't take query parameters, so the
// values are inlined. They are always the code constants above, never user input.
function isOneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const quotedValues = values.map((value) => `'${value}'`).join(', ');
  return sql`${column} in (${sql.raw(quotedValues)})`;
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    snaptradeSub: text('snaptrade_sub').notNull().unique(),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    killSwitch: boolean('kill_switch').notNull().default(false),
    mode: text('mode', { enum: MODES }).notNull().default('paper'),
    needsReauth: boolean('needs_reauth').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('users_mode_check', isOneOf(table.mode, MODES)),
    // The sweeper finds demo users older than 24 hours.
    index('users_is_demo_created_at_idx').on(table.isDemo, table.createdAt),
  ],
);

export const sessions = pgTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  csrfToken: text('csrf_token').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
});

// Pre-login state for SnapTrade sign-in. No user exists yet, so there is no user FK.
export const loginAttempts = pgTable('login_attempts', {
  idHash: text('id_hash').primaryKey(),
  state: text('state').notNull().unique(),
  codeVerifierEnc: text('code_verifier_enc').notNull(),
  nonce: text('nonce').notNull(),
  returnTo: text('return_to'),
  mcpAuthRequestId: uuid('mcp_auth_request_id'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  consumedAt: timestamptz('consumed_at'),
});

export const snaptradeGrants = pgTable('snaptrade_grants', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  accessExpiresAt: timestamptz('access_expires_at').notNull(),
  scope: text('scope').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const connections = pgTable(
  'connections',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    brokerageName: text('brokerage_name').notNull(),
    type: text('type', { enum: CONNECTION_TYPES }).notNull(),
    disabled: boolean('disabled').notNull().default(false),
    disabledAt: timestamptz('disabled_at'),
    syncedAt: timestamptz('synced_at').notNull(),
  },
  (table) => [check('connections_type_check', isOneOf(table.type, CONNECTION_TYPES))],
);

// Every account we've seen. Accounts are never deleted by a sync (`present` goes false
// instead), so references between non-user tables don't cascade; only deleting the user does.
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    snaptradeAccountId: uuid('snaptrade_account_id').notNull(),
    connectionId: text('connection_id')
      .notNull()
      .references(() => connections.id),
    institutionName: text('institution_name').notNull(),
    name: text('name').notNull(),
    numberLast4: text('number_last4').notNull(),
    rawType: text('raw_type').notNull(),
    accountCategory: text('account_category'),
    isPaper: boolean('is_paper').notNull(),
    allowed: boolean('allowed').notNull().default(false),
    present: boolean('present').notNull().default(true),
    syncedAt: timestamptz('synced_at').notNull(),
  },
  (table) => [
    unique('accounts_user_id_snaptrade_account_id_unique').on(
      table.userId,
      table.snaptradeAccountId,
    ),
  ],
);

export const policies = pgTable('policies', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  rules: jsonb('rules').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

// A pending /oauth/authorize while the user signs in or consents.
export const mcpAuthRequests = pgTable('mcp_auth_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri').notNull(),
  state: text('state').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
});

// One per (user, AI client): the "Connected AI apps" list.
export const mcpGrants = pgTable('mcp_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull(),
  clientHost: text('client_host').notNull(),
  scope: text('scope').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
  revokedAt: timestamptz('revoked_at'),
});

// Codes and tokens mean nothing without their grant, so they go with it.
export const mcpAuthCodes = pgTable('mcp_auth_codes', {
  codeHash: text('code_hash').primaryKey(),
  grantId: uuid('grant_id')
    .notNull()
    .references(() => mcpGrants.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scope: text('scope').notNull(),
  resource: text('resource').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
});

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => mcpGrants.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MCP_TOKEN_KINDS }).notNull(),
    scope: text('scope').notNull(),
    resource: text('resource').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('mcp_tokens_kind_check', isOneOf(table.kind, MCP_TOKEN_KINDS)),
    index('mcp_tokens_grant_id_idx').on(table.grantId),
  ],
);

export const orderIntents = pgTable(
  'order_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    // Which AI proposed it. Kept as history if the grant row ever goes away.
    grantId: uuid('grant_id').references(() => mcpGrants.id, { onDelete: 'set null' }),
    idempotencyKey: uuid('idempotency_key'),
    fingerprint: text('fingerprint').notNull(),
    symbol: text('symbol').notNull(),
    universalSymbolId: uuid('universal_symbol_id').notNull(),
    securityType: text('security_type').notNull(),
    currency: text('currency').notNull(),
    exchange: text('exchange'),
    side: text('side', { enum: SIDES }).notNull(),
    quantity: numeric('quantity').notNull(),
    orderType: text('order_type', { enum: ORDER_TYPES }).notNull(),
    limitPrice: numeric('limit_price'),
    timeInForce: text('time_in_force').notNull().default('Day'),
    mode: text('mode', { enum: MODES }).notNull(),
    estPrice: numeric('est_price'),
    estValue: numeric('est_value'),
    priceSource: text('price_source').notNull(),
    priceAsOf: timestamptz('price_as_of'),
    status: text('status', { enum: INTENT_STATUSES }).notNull(),
    checkResults: jsonb('check_results').notNull(),
    policyVersion: integer('policy_version').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    decidedAt: timestamptz('decided_at'),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    check('order_intents_side_check', isOneOf(table.side, SIDES)),
    check('order_intents_order_type_check', isOneOf(table.orderType, ORDER_TYPES)),
    check('order_intents_mode_check', isOneOf(table.mode, MODES)),
    check('order_intents_status_check', isOneOf(table.status, INTENT_STATUSES)),
    unique('order_intents_user_id_idempotency_key_unique').on(table.userId, table.idempotencyKey),
    index('order_intents_user_id_created_at_idx').on(table.userId, table.createdAt),
    // The sweeper finds PENDING_APPROVAL intents whose window has passed.
    index('order_intents_status_expires_at_idx').on(table.status, table.expiresAt),
  ],
);

export const executions = pgTable(
  'executions',
  {
    intentId: uuid('intent_id')
      .primaryKey()
      .references(() => orderIntents.id, { onDelete: 'cascade' }),
    executor: text('executor', { enum: EXECUTORS }).notNull(),
    clientOrderId: uuid('client_order_id'),
    brokerageOrderId: text('brokerage_order_id'),
    submittedAt: timestamptz('submitted_at'),
    filledQuantity: numeric('filled_quantity').notNull().default('0'),
    avgFillPrice: numeric('avg_fill_price'),
    brokerStatus: text('broker_status'),
    lastCheckedAt: timestamptz('last_checked_at'),
    // Sanitised: only the fields we show, never a raw SnapTrade body.
    result: jsonb('result').notNull().default({}),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [check('executions_executor_check', isOneOf(table.executor, EXECUTORS))],
);

export const paperPositions = pgTable(
  'paper_positions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    symbol: text('symbol').notNull(),
    quantity: numeric('quantity').notNull(),
    avgCost: numeric('avg_cost').notNull(),
    currency: text('currency').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.accountId, table.symbol] })],
);

export const paperCash = pgTable(
  'paper_cash',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    currency: text('currency').notNull(),
    cashChange: numeric('cash_change').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.accountId, table.currency] })],
);

// Append-only: a database trigger (migration 0001_audit_guard) blocks UPDATE, and blocks
// DELETE except inside the account-deletion transaction (PRODUCT_VISION §14.3).
// `intent_id` has no FK so the audit trail never depends on another table's rows.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intentId: uuid('intent_id'),
    actor: text('actor', { enum: ACTORS }).notNull(),
    actorDetail: text('actor_detail'),
    eventType: text('event_type').notNull(),
    details: jsonb('details').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('audit_events_actor_check', isOneOf(table.actor, ACTORS)),
    index('audit_events_user_id_created_at_idx').on(table.userId, table.createdAt),
  ],
);

// Not linked to users: SnapTrade may send events for users we don't know (yet).
export const webhookEvents = pgTable('webhook_events', {
  webhookId: uuid('webhook_id').primaryKey(),
  eventType: text('event_type').notNull(),
  userSub: text('user_sub').notNull(),
  connectionId: text('connection_id'),
  accountId: text('account_id'),
  eventTimestamp: timestamptz('event_timestamp').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
  stale: boolean('stale').notNull().default(false),
  processedAt: timestamptz('processed_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});
