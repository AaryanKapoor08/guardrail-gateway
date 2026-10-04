# Decisions

Every non-obvious choice: **what** we chose, **why**, and the **alternatives** considered. Newest at the bottom. Full context in `PRODUCT_VISION.md`.

---

### D1 — Node.js 24 LTS (2026-10-03)
- **What:** Node 24.
- **Why:** Node 20 reached end of life on 2026-04-30. Node 24 is LTS with security support until 2028-04-30.
- **Alternatives:** Node 22 (maintenance-only until 2027-04-30).

### D2 — Place live orders with `POST /trade/place`; impact is preview-only (2026-10-03)
- **What:** validate in our app, place with Place Equity Order. Order impact is shown on the approval page only when the broker supports it.
- **Why:** SnapTrade's docs recommend this as the primary equity workflow. Previews aren't available for every broker, and an impact `tradeId` expires after 5 minutes, which would couple execution to how fast a human approves.
- **Alternatives:** impact → place checked order by `tradeId` (the original brief's plan).

### D3 — MCP SDK v2 + our own small authorization server using CIMD (2026-10-03)
- **What:** `@modelcontextprotocol/server` v2 + `@modelcontextprotocol/hono` for the endpoint and bearer gate. A hand-written OAuth AS (authorization code + PKCE S256 + rotating refresh + CIMD + revocation) with a client host allowlist.
- **Why:** the MCP spec 2026-07-28 deprecates DCR in favour of CIMD; Claude supports CIMD. SDK v2 no longer ships AS helpers. The subset we need is small and explainable. The host allowlist blocks look-alike clients and SSRF.
- **Alternatives:** DCR (deprecated; kept as a documented fallback); `oidc-provider` (powerful but large); an external IdP (would complicate linking to SnapTrade sign-in).

### D4 — Opaque, hashed MCP tokens instead of JWTs (2026-10-03)
- **Why:** instant revocation (kill switch, revoke app, disconnect, delete) and no signing keys to manage. Cost: one indexed DB lookup per MCP request. SHA-256 is appropriate for high-entropy random tokens.
- **Alternatives:** signed JWT access tokens + deny-list.

### D5 — $0 hosting: Render free + keep-awake ping (2026-10-03)
- **What:** Render free web service, plus a free uptime monitor requesting `/health` every 5 minutes. Neon free for Postgres.
- **Why:** free Render instances sleep after 15 idle minutes and take 30–60s to wake, but Claude allows only 10s for OAuth discovery and token endpoints. A 5-minute ping prevents sleep. Render's 750 free hours/month cover one service for a full 31-day month (744h), and its docs don't prohibit keep-alive traffic. Free instances can restart without notice; our design tolerates that (state in Postgres, idempotent background tasks). This keeps the simple "one always-running server" design at no cost.
- **Constraints we accept:** only one free Render service in the workspace (two always-awake services would exceed the hours, and Render suspends free services until next month); no SMTP ports (we use Resend over HTTPS).
- **Alternatives:** Render Starter ~$7/mo (same behaviour without the ping; not needed). Vercel Hobby (free, no sleep, but serverless: free cron runs once a day so there's no 60s sweeper, and in-memory caches and rate limits must move to the database). Plain Render free without a ping (fails Claude's timeouts).

### D6 — Webhooks are re-sync hints; stale-but-signed events are accepted and flagged (2026-10-03)
- **Why:** SnapTrade retries failed deliveries starting 30 minutes later, so a strict 5-minute freshness rejection would drop every retry. Because processing only ever re-reads state from the API, a replay is harmless. Dedupe by `webhookId` stops exact replays.
- **Alternatives:** reject events older than 5 minutes (loses legitimate retries).

### D7 — Single policy currency, no FX (2026-10-03)
- **Why:** we have no reliable FX source. Refusing a cross-currency order beats guessing with someone's money.
- **Alternatives:** per-currency limits; an FX data provider (future).

### D8 — Never auto-retry an order placement; `UNKNOWN` state + reconciliation (2026-10-03)
- **Why:** a timeout may still have placed the order, so retrying risks a double order. We pass the intent id as `client_order_id` (broker-specific idempotency) and reconcile against recent orders, falling back to the user's confirmation.

### D9 — Per-user row lock (`SELECT … FOR UPDATE` on `users`) around proposals, approvals, and the kill switch (2026-10-03)
- **Why:** prevents two approvals both fitting under the daily limit, and double execution. Row locks (not session advisory locks) are safe through Neon's PgBouncer transaction pooling.

### D10 — Idempotency key unique per user forever, with fingerprint check (2026-10-03)
- **Why:** simpler than a 24-hour window and gives the same protection. A reused key with different order details is an error (Stripe-style).

### D11 — Approval link also returned to the AI and listed on the dashboard; email optional (2026-10-03)
- **Why:** email delivery is not guaranteed (Resend requires a verified domain to email others; spam filters), and the approval window is 10 minutes. The link alone never approves anything (session + POST + CSRF).

### D12 — Money as `numeric` + `big.js`; times compared against the injected clock (2026-10-03)
- **Why:** exact decimal arithmetic. Deterministic tests for expiry and daily limits.

---

*(Add decisions made during the build below, e.g. capability spike results for Q3/Q6/Q9/Q11.)*

### D13 — Phase 1 tooling details (2026-10-04)
- **What:**
  - `.env` is read with Node's built-in `process.loadEnvFile()` (in `loadDotEnvFileIfPresent()`), called by `server.ts` and `db/migrate.ts` only. A missing file is normal (Render injects real env vars). Real environment variables win over the file.
  - Biome 2.5 deprecated `"recommended": true`; the config uses `"preset": "recommended"` (produced by `biome migrate`). The floating-promise rules (`noFloatingPromises`, `noMisusedPromises`) live in Biome's **nursery** group in 2.5 and are switched on explicitly as errors.
  - TypeScript 7.0.2 accepted every option in BuildFlow P1 task 3 unchanged. `tsconfig.json` also sets `noEmit: true` (so `tsc --noEmit` and editors never write files); `tsconfig.build.json` turns emit back on.
  - The Docker test database container is named `gg-db-test`, so it can be removed by exact name.
  - Tests default `TEST_DATABASE_URL` to the Docker URL from `docker-compose.yml` (not a secret) when it isn't set, so `npm test` doesn't need `.env`.
  - CI uses `actions/checkout@v7` and `actions/setup-node@v7` (latest releases on 2026-10-04), and a fake key of 32 zero bytes.
- **Why:** no extra dependency (`dotenv`) for something Node 24 does natively; keep the linter config on the non-deprecated syntax.
- **Alternatives:** `dotenv` package; `node --env-file-if-exists` flags in every script (harder to see, and `tsx watch` / `vitest` handle flags differently).

### D14 — Phase 2 schema and foundation details (2026-10-04)
- **Nullability:** a column marked `null` in V§14.1 is nullable; every other column is `NOT NULL`. Fields that may be missing from SnapTrade (e.g. account `name`, `raw_type`) are therefore required; the sync (P4) must supply a fallback, or a later migration relaxes the column with a note here.
- **Foreign keys:** everything owned by a user cascades from `users` (V§14). References *between* user-owned tables don't cascade (`accounts.connection_id`, `order_intents.account_id`, `paper_*.account_id`), because accounts and connections are never deleted by a sync (`present`/`disabled` flags instead); deleting the user still removes all of it in one statement. `mcp_auth_codes` / `mcp_tokens` cascade from their `mcp_grants` row (meaningless without it). `executions` cascades from its intent. `order_intents.grant_id` is `ON DELETE SET NULL` so an intent's history survives a removed grant. `audit_events.intent_id` and `login_attempts.mcp_auth_request_id` have no FK. A test proves deleting a user empties every table.
- **Check constraints** for every fixed set, including `connections.type` (`read`/`trade`) in addition to the list in BuildFlow P2. The 13 intent statuses (V§7.1) live in `src/db/schema.ts` as `INTENT_STATUSES`; P7 may move the list into the pure state-machine module and have the schema import it.
- **Timestamps:** `created_at`/`updated_at` default to `now()` only as a fallback. Code that later *compares* a timestamp (demo-user expiry, intent expiry, sessions) passes `deps.now()` explicitly (Global Rule 7). For the same reason **`writeAudit` takes a required `createdAt`** (a small addition to the BuildFlow signature).
- **Audit deletion setting:** the app will use `select set_config('app.deleting_user', $userId, true)` rather than the literal `SET LOCAL app.deleting_user = '…'`: identical effect (local to the transaction), but the id is a query parameter instead of string-built SQL. The trigger SQL itself is verbatim from V§14.3.
- **Migrations:** `src/db/migrate.ts` needs only `DATABASE_URL` (or `TEST_DATABASE_URL` with `MIGRATE_TARGET=test`), not the full app env, and runs only when executed directly (`import.meta.main`, Node 24), so tests can import `runMigrations()`. Both migrations applied cleanly to Neon **through the pooler**; no direct connection was needed.
- **Money:** `decimalPlaces()` ignores trailing zeros (`"1.50"` → 1), so `"1.000"` is treated as a whole number. `dec()` accepts plain decimal strings only (no exponent, no `+`, no spaces). `fmtMoney()` shows the code too (`$1,234.50 USD`) because `$` alone can't tell USD and CAD apart.
- **Test cleanup:** `truncateAll()` derives the table list from the Drizzle schema, so a new table can't be forgotten.

### D15 — Phase 3 sign-in details (2026-10-04)
- **Caches live in `deps`, not in modules.** `createTtlCache` (`snaptrade/cache.ts`) was pulled forward from P4 because discovery needs a 24h cache that shares one in-flight load. `createDeps` builds every cache once (`deps.caches`), so tests get fresh caches and there is no module-level mutable state.
- **id_token keys are injected** as `deps.idTokenKeys(jwksUri)`. Production returns one `createRemoteJWKSet` per URL (jose caches the keys and refetches on an unknown `kid`); tests return `createLocalJWKSet` over the fake's keys. `verifyIdToken` passes `currentDate: deps.now()` so expiry checks follow the injected clock.
- **Origin check uses `APP_BASE_URL`'s origin**, not the request URL. Behind Render's TLS proxy the server sees `http://…` while browsers send an `https://…` Origin, so Hono's default "same as request URL" would reject every real form POST. Machine routes (`/oauth/token`, `/oauth/revoke`, `/mcp`, `/webhooks/*`) skip it.
- **Login attempts are consumed by one `UPDATE … WHERE consumed_at IS NULL AND expires_at > $now RETURNING`**, so two callbacks racing for the same attempt can't both proceed. The attempt is consumed before anything else is checked (wrong state, declined consent, failed exchange all use it up).
- **`error=…` on the callback is handled before the state check.** It only shows the "you declined, nothing was stored" page; nothing is written, so a forged one is harmless.
- **Client authentication:** `Authorization: Basic base64(urlencode(id):urlencode(secret))` per RFC 6749 §2.3.1. PKCE verifier, state, and nonce are each 32 random bytes in base64url (43 characters, the RFC 7636 minimum length).
- **Not signed in:** a GET redirects to `/login?return_to=<path>`; any other method redirects to `/login` without a return path (a POST can't be replayed as a GET).
- **HTML responses** go through `renderPage()`, which prefixes the fixed `<!doctype html>` (JSX can't express it) and otherwise relies on Hono JSX escaping.
- **`SIDES`, `ORDER_TYPES`, `MODES` moved to `src/policy/types.ts`** and the DB schema imports them, so `src/policy/**` never imports database modules (P7 checkpoint).
- **Note for P9:** Chrome applies CSP `form-action` to redirects after a form POST, so the consent page's CSP must also allow the MCP client's redirect origin, or "Approve" would be blocked on the way back to Claude.
- **Alternatives:** a module-level cache (simpler, but tests would share state); the request URL for the origin check (breaks behind the proxy).

### D16 — Phase 4 accounts sync details (2026-10-04)
- **Nullable account fields (migration `0002_accounts_nullable_fields`):** SnapTrade's *List Accounts* reference documents `name`, `raw_type`, and `account_category` as nullable, and some brokers mask or omit `number`. `accounts.raw_type` and `accounts.number_last4` are now nullable (`account_category` already was). `name` stays NOT NULL with a fallback: SnapTrade's name → `raw_type` → "Unnamed account". `institution_name` falls back to the connection's brokerage name. Supersedes the "fallback or relax later" note in D14.
- **Response schemas are tolerant where the docs say nullable**, and strict on what we key on (`id` must be a UUID, `brokerage_authorization` present, `disabled` a boolean). A connection `type` other than `trade` is stored as `read`, and a missing `is_paper` counts as a real-money account, so unknowns always fall on the safe side of the live-trading gates. **Verify these shapes against real Sandbox responses in P5.**
- **Base URL:** calls go to `${SNAPTRADE_API_BASE_URL}<path>` with no `/api/v1` (V§5.2). The checkpoint item "confirmed with a real call" is deferred to Aaryan's P5 spike; tests assert the exact URL built.
- **429 waits:** `X-RateLimit-Account-Reset` → `X-RateLimit-Reset` → "available in N seconds" (all are *seconds to wait*, per SnapTrade's rate-limiting page) → full-jitter backoff `random() × min(10s, 0.5s × 2^n)`. Every wait is capped at 10 seconds so a page never hangs on a long hint; after 2 retries the call fails with a `SnapTradeApiError` (status only, no body).
- **Accounts whose connection isn't in `/authorizations`** are skipped for that sync (the row needs its connection). Connections missing from the response are left as they were; their accounts become `present = false`, which already fails `account_allowed`.
- **Sync cadence:** after every sign-in (forced, failures logged and shown later as a banner), on dashboard load at most once per 5 minutes per user (`deps.caches.accountSyncs`, shared in-flight load), and on "Refresh from SnapTrade" (forced). Each sync writes one `accounts.synced` audit row with counts.
- **Allowing an account takes the per-user row lock** (`db/locks.ts`, `lockUserRow`) like every other change the policy engine depends on. `setAccountAllowed` lives in a small `src/accounts/service.ts` (not in the target tree; it keeps the route thin).
- **Alternatives:** keep the columns NOT NULL and store empty strings (hides "unknown" behind a fake value); retry until any hinted wait passes (could hold a request for a minute).

### D17 — Phase 6 token lifecycle details (2026-10-04)
- **One refresh function for both triggers.** `refreshAccessToken(deps, userId, seenAccessTokenHash)` locks the grant row, and refreshes only if the stored access token is still the one the caller saw (same SHA-256). If it changed, another request already refreshed and the new token is reused. BuildFlow also listed "expiry is now > 5 minutes away" as a skip condition; it is dropped because a token SnapTrade *rejected* with 401 is usually far from expiry, so that check would skip the refresh the 401 path needs. The hash check alone covers both cases.
- **`invalid_grant`:** the grant row is deleted inside the same locked transaction (so callers queued on the lock find no grant and stop), then a second transaction locks the `users` row, sets `needs_reauth = true`, and writes `snaptrade.reauth_required`. Splitting it keeps the documented lock order (users first) without holding the users lock during the HTTP call.
- **Second 401 after a refresh** clears the stored tokens too (V§5.1 "clear the tokens and ask the user to authorize again") via the same `markNeedsReauth`.
- **Other refresh failures** (5xx, `invalid_client`, malformed response) throw `[Tokens] SnapTrade refresh failed` and keep the grant; only a network error is retried, once, with the same refresh token (V§12.2).
- **401 retry applies to writes too:** a 401 means SnapTrade rejected the request before doing anything, so one retry with a fresh token cannot double an order.
- **Disconnect** = revoke at SnapTrade (best effort) → delete our grant regardless → in one transaction (user row locked) revoke every MCP grant and token and audit `snaptrade.disconnected` `{ revokedAtSnapTrade, revokedAiApps }` → destroy the session. Cancelling pending intents is added with the intent service in P8.
- **Alternatives:** an in-memory per-user mutex (breaks with more than one process); refreshing proactively on a timer (more SnapTrade calls, same correctness).
