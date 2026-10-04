# Guardrail Gateway: Build Flow

A phase is done when its checkpoint passes, not when the code is written.

**Source of truth for *what* and *why*:** `PRODUCT_VISION.md` (cited below as `V§n`).
**This file is the source of truth for *how* and *in what order*.** If the two ever disagree, stop and fix the docs before writing code.

Phase ↔ milestone map: P0 prerequisites · P1–P2 = M0 · P3–P4 = M1 · P5 = M2 · P6 = M3 · P7 = M4 · P8 = M5 · P9–P10 = M6 · P11 = M7 · P12 = M8 · P13 = M9 · P14 = M10.

---

## Prerequisites (machine)

| Tool | Required version | Check |
|---|---|---|
| Node.js | **24.x LTS** (`.nvmrc` = `24`) | `node -v` → `v24.*` |
| npm | ships with Node 24 | `npm -v` |
| Docker Desktop | running (test Postgres) | `docker info` shows "Server Version" |
| Git + GitHub CLI | any recent, `gh auth status` logged in | `gh auth status` |

**Do NOT install until the phase that needs it:** `big.js` (P2), `@vitest/coverage-v8` (P7, dev), `@modelcontextprotocol/server` + `@modelcontextprotocol/hono` (P9), `@modelcontextprotocol/client` (P10, dev only).

---

## Global Rules (all phases)

1. **Branching:** `feat/p<N>-<slug>` from `main`. When the checkpoint passes: `git checkout main && git merge --ff-only feat/p<N>-<slug> && git push`. Never commit work-in-progress straight to `main`.
2. **Commits:** `<type>(<scope>): <description>`, imperative, < 72 chars. Types: `feat fix chore test refactor docs ci`. Scopes: `config db crypto auth snaptrade oidc tokens sync web policy intents approvals executor paper live oauth-server mcp webhooks audit jobs ci docs`. One logical change per commit. Refactors go in their own commit.
3. **Secrets:** never in git. Before every commit run `git diff --cached` and look for keys, tokens, and connection strings. `.env` is git-ignored. The process refuses to start without valid env (P1).
4. **Errors:** every `catch` either handles the error meaningfully or rethrows with `new Error('[Module] what failed', { cause: error })`. Never swallow errors silently. Never log tokens, codes, `id_token`s, secrets, raw SnapTrade bodies, or account numbers.
5. **Validation:** Zod at every boundary: env, HTTP forms and query strings, OAuth parameters, MCP tool inputs, webhook bodies, **and SnapTrade responses** (parse only the fields we use).
6. **Imports:** ESM with `module`/`moduleResolution` = `NodeNext`, so **relative imports end in `.js`** (e.g. `import { env } from './config/env.js'`).
7. **Time:** all "now" values come from the injected clock `deps.now()`. SQL compares against a **parameter** (`$now`), never SQL `now()` (V§8.3). Tests control time.
8. **Money and quantities:** `numeric` in Postgres, strings at boundaries, `big.js` in code. **Never** JS `number` arithmetic on money or quantity.
9. **Dependency injection:** `createApp(deps)` where `deps = { db, env, fetch, now, logger }`. Tests pass a fake `fetch` (fake SnapTrade) and a controllable clock. **No automated test ever hits the real SnapTrade API.**
10. **Library APIs:** before using any library API (SDK v2 especially), check the installed version's docs or types in `node_modules`. Don't code from memory.
11. **Docs as you go:** non-obvious choice → `DECISIONS.md` (what / why / alternatives). SnapTrade surprise → `API_FEEDBACK.md`. After each phase: update `claude/Progress.md` and give Aaryan a plain-English summary (what was built, how it works, why this way, what could break).
12. **Stop-and-ask gates** are marked ⛔. At a gate, stop, record findings, and tell Aaryan before continuing.

### Definition of Done (every phase)

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm test` passes (unit + integration), and CI is green on the pushed branch
- [ ] Every checkpoint item for the phase is ticked
- [ ] `git diff` reviewed for secrets before each commit
- [ ] `DECISIONS.md` / `API_FEEDBACK.md` updated if anything non-obvious happened
- [ ] `claude/Progress.md` updated, and the plain-English summary given to Aaryan
- [ ] Branch fast-forward merged to `main` and pushed

---

## Target file tree (end state)

```
src/
  app.ts                     createApp(deps): Hono app with all routes + middleware
  server.ts                  boot: load env, create deps, start HTTP, start sweeper, graceful shutdown
  deps.ts                    Deps type + createDeps(env)
  config/env.ts              Zod env schema + parse (fails fast)
  db/client.ts               pg Pool + drizzle instance
  db/schema.ts               all tables (V§14)
  db/migrate.ts              run drizzle migrations (used in dev, CI, Render start)
  db/migrations/             generated SQL + custom audit-trigger migration
  lib/crypto.ts              AES-256-GCM, sha256, random tokens, constant-time compare
  lib/money.ts               big.js helpers
  lib/logger.ts              JSON logger with field allowlist
  lib/ratelimit.ts           in-memory sliding-window limiter
  lib/time.ts                Toronto-day + display formatting helpers
  lib/errors.ts              typed app errors (NeedsReauthError, PolicyInputError, …)
  audit/write.ts             writeAudit(tx, event)
  auth/sessions.ts           session create/load/destroy, cookie settings, requireSession middleware
  auth/csrf.ts               per-session token, hidden-field helper, verify middleware
  auth/login-routes.ts       /login, /oauth/snaptrade/callback, /logout
  auth/return-to.ts          safe relative-path validator
  snaptrade/discovery.ts     AS + OIDC metadata (cached)
  snaptrade/oidc.ts          authorize URL, code exchange, id_token verify
  snaptrade/tokens.ts        token vault + single-flight refresh + revoke
  snaptrade/api.ts           snaptradeFetch (timeouts, 429 handling, 401 refresh-retry)
  snaptrade/resources.ts     typed calls: connections, accounts, positions/all, balances, quotes, symbols, place, impact, recentOrders
  snaptrade/cache.ts         TTL caches (V§12.3)
  snaptrade/sync.ts          syncUserConnectionsAndAccounts(userId)
  policy/schema.ts           PolicyRules Zod schema + defaults + hard ceilings
  policy/types.ts            OrderRequest, PolicyContext, RuleResult, RuleId
  policy/rules/*.ts          one pure function per rule
  policy/evaluate.ts         evaluate(policy, order, ctx)
  policy/describe.ts         plain-language policy text for get_policy
  intents/state-machine.ts   transition(state, event)  (pure)
  intents/service.ts         propose / approve / deny / cancel / expireDue / killSwitch / resolveUnknown
  intents/context.ts         builds PolicyContext (fetch outside lock + DB counts inside lock)
  intents/symbols.ts         resolveSymbol(account, ticker)
  executors/executor.ts      Executor interface
  executors/paper.ts         PaperExecutor
  executors/snaptrade.ts     SnapTradeExecutor (P13)
  approvals/routes.tsx       GET /approvals/:id, POST approve/deny
  approvals/email.ts         Resend via fetch (or console in dev)
  oauth-server/metadata.ts   PRM + AS metadata routes
  oauth-server/cimd.ts       fetch + validate + cache client metadata docs, redirect matching
  oauth-server/authorize.ts  GET /oauth/authorize + consent POST
  oauth-server/token.ts      POST /oauth/token
  oauth-server/revoke.ts     POST /oauth/revoke
  oauth-server/verify.ts     verifyAccessToken for the MCP bearer gate
  mcp/handler.ts             SDK v2 createMcpHandler + bearer gate + rate limit
  mcp/tools/*.ts             one file per tool (8)
  webhooks/canonical-json.ts Python-compatible canonical JSON
  webhooks/verify.ts         signature check
  webhooks/routes.ts         POST /webhooks/snaptrade
  webhooks/processor.ts      process stored events (re-sync)
  jobs/sweeper.ts            runSweepOnce + startSweeper
  web/layout.tsx             base layout, nav, disclaimer footer
  web/routes.tsx             dashboard, accounts, policy, intents, audit, apps, kill switch, mode, disconnect, delete, privacy
  web/pages/*.tsx            page components
tests/
  helpers/db.ts              migrate + truncate test DB
  helpers/fake-snaptrade.ts  programmable fake SnapTrade (Request → Response) with call counters + RSA keys
  helpers/clock.ts           controllable clock
  helpers/app.ts             build app with fakes, log in a test user, get CSRF token
  unit/**                    pure logic
  integration/**             real Postgres + fakes
public/
  styles.css                 served at /static/styles.css (outside src/ because tsc doesn't copy CSS into dist/)
scripts/
  demo-flow.ts               P8 end-to-end without AI
  spike.ts                   P5 capability spike (manual, real Sandbox)
.github/workflows/ci.yml
docker-compose.yml           postgres:17 for tests (port 5433)
```

---

## PHASE 0 — Accounts, Keys, Machine (human tasks)

**Goal:** everything the code needs from the outside world exists, and `.env` is filled.

**Tasks (Aaryan):**
1. Install **Node 24 LTS** (`winget install OpenJS.NodeJS.LTS` or nvm-windows `nvm install 24 && nvm use 24`), then confirm `node -v` shows `v24.*`.
2. Start **Docker Desktop** and confirm `docker info` works.
3. **SnapTrade Commercial dashboard** (https://dashboard.snaptrade.com), required for OAuth apps:
   - **OAuth Apps → create the Test app.** Add redirect URI `http://localhost:3000/oauth/snaptrade/callback` (exact, no trailing slash).
   - Copy **client_id** and **client_secret**. The secret is shown **once**.
   - **API Keys:** copy the **consumer key** (used only to verify webhook signatures).
4. **SnapTrade Personal** workspace (the *test user*): connect the **SnapTrade Sandbox** brokerage. Use a different login from the Commercial account if the dashboard requires it.
5. **Trade scope:** confirm the support email asking to enable `trade` for the Test app has been sent (V§21 Q1).
6. **Neon** (https://neon.tech, sign in with GitHub): create project `guardrail-gateway` and pick region **US East (N. Virginia)** from the dropdown. **No AWS account or setup needed.** Neon hosts on AWS internally, and the region label is just where the database lives. It should match the Render region (Virginia) for low latency. Copy the **pooled** connection string (Connection pooling toggle on; host contains `-pooler`, ends with `sslmode=require`) into `.env` as `DATABASE_URL`.
7. **Render** account (https://render.com), connected to GitHub. Used in P5.
8. *Optional, recommended:* a domain (≈ $10–15/yr) and a **Resend** account with that domain verified (needed to email anyone but yourself).
9. Fill `.env` (template already created; `TOKEN_ENCRYPTION_KEY` is pre-generated).

**Checkpoint:**
- [ ] `node -v` → `v24.*`
- [ ] `docker info` succeeds
- [ ] SnapTrade Test OAuth app exists with the localhost redirect URI; client id + secret saved in `.env`
- [ ] Consumer key saved in `.env`
- [ ] SnapTrade Personal test workspace has the Sandbox brokerage connected
- [ ] Neon pooled `DATABASE_URL` saved in `.env`
- [ ] Render account exists and is linked to GitHub

---

## PHASE 1 — Project Scaffold (M0, part 1)

**Goal:** a typed, tested, CI-checked Hono server that refuses to start with bad config and answers `/health` with a DB check.

**Install:**
```
npm init -y
npm i hono @hono/node-server zod pg drizzle-orm jose
npm i -D typescript @types/node@24 @types/pg tsx vitest drizzle-kit
```

**Tasks:**
1. `package.json`: `"type": "module"`, `"engines": { "node": ">=24 <25" }`, scripts:
   - `dev` = `tsx watch src/server.ts`
   - `build` = `tsc -p tsconfig.build.json`
   - `start` = `node dist/server.js`
   - `typecheck` = `tsc --noEmit`
   - `test` = `vitest run`, `test:watch` = `vitest`
   - `db:generate` = `drizzle-kit generate`, `db:migrate` = `tsx src/db/migrate.ts`
   - `db:test:up` = `docker compose up -d db-test`
2. `.nvmrc` = `24`.
3. `tsconfig.json`: `strict: true`, `target: "ES2023"`, `module`/`moduleResolution: "NodeNext"`, `jsx: "react-jsx"`, `jsxImportSource: "hono/jsx"`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `skipLibCheck: true`.
   `tsconfig.build.json` extends it with `outDir: "dist"`, `rootDir: "src"`, `include: ["src"]`.
4. `src/config/env.ts`: Zod schema for every variable in V§16 plus `TEST_DATABASE_URL` (optional).
   - Booleans via `z.stringbool()`. `PORT` coerced to a number. URLs validated.
   - `TOKEN_ENCRYPTION_KEY` must base64-decode to **exactly 32 bytes**.
   - **Refine:** `new URL(SNAPTRADE_REDIRECT_URI).origin === new URL(APP_BASE_URL).origin` (prevents the localhost vs 127.0.0.1 cookie bug, V§0 G15).
   - In production, `APP_BASE_URL` must be `https:`. `APP_BASE_URL` must have **no trailing slash and no path** (refine), so `issuer`, `resource`, and approval URLs are built consistently.
   - `MCP_ALLOWED_CLIENT_HOSTS` is parsed into a lowercase string array (non-empty).
   - Export `loadEnv(source = process.env)`, which throws a single readable error listing **every** invalid key (names only, never values).
5. `src/lib/logger.ts`: `createLogger(level)` returning `{ debug, info, warn, error }(msg, fields)`. Writes one JSON line. Only fields from an **allowlist** (`route, method, status, durationMs, userId, intentId, event, snaptradeRequestId, attempt, count, rule, state, reason, clientHost, errorName, errorMessage`) are emitted. Anything else is dropped. `logError(err)` emits only `errorName` + `errorMessage` (our own safe messages; never response bodies) and walks `cause` names.
6. `src/db/client.ts`: `createDb(url)` returns `{ pool, db }` (pg `Pool`, `max: 5`, `ssl` per the URL) using `drizzle(pool)`.
7. `src/deps.ts`: `type Deps = { env, db, pool, fetch: typeof fetch, now: () => Date, logger }`, plus `createDeps(env)`.
8. `src/app.ts`: `createApp(deps)` returns a Hono app with `GET /health`. It runs `SELECT 1`, then returns `200 {"status":"ok"}`, or `503 {"status":"degraded"}` on DB failure (logged).
9. `src/server.ts`: `loadEnv()` (exit 1 on failure with the readable message), `createDeps`, `serve({ fetch: app.fetch, port })`. On **SIGTERM/SIGINT**: stop accepting, wait ≤ 10s for in-flight requests, `pool.end()`, exit.
10. `docker-compose.yml`: service `db-test` = `postgres:17`, port `5433:5432`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=guardrail_test`, `tmpfs: /var/lib/postgresql/data`.
11. `vitest.config.ts`: `test.include: ["tests/**/*.test.ts"]`, `fileParallelism: false` (integration tests share one DB), `testTimeout: 20000`.
12. `.github/workflows/ci.yml`: on push and PR. Ubuntu, Node 24 (`actions/setup-node` with `node-version-file: .nvmrc`), service `postgres:17` on 5433, `npm ci`, `npm run typecheck`, `npm test` with `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/guardrail_test` and dummy-but-valid values for the other required env vars (a CI-only random key; never real secrets).
13. Tests:
    - `tests/unit/env.test.ts`: valid env parses; missing var → error names it; 31-byte key rejected; mismatched redirect origin rejected; values never appear in error messages.
    - `tests/integration/health.test.ts`: `/health` → 200 with test DB.

**Checkpoint:**
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run db:test:up && npm test` → env + health tests pass
- [ ] `npm run dev` with real `.env` → `curl localhost:3000/health` returns `{"status":"ok"}` (Neon reachable)
- [ ] Starting with `TOKEN_ENCRYPTION_KEY` removed prints a readable error and exits 1
- [ ] CI workflow green on GitHub
- [ ] Commits: `chore(config): scaffold node 24 hono server with env validation` · `test(config): cover env validation and health check` · `ci: run typecheck and tests on push`

---

## PHASE 2 — Database Schema + Foundations (M0, part 2)

**Goal:** the full schema exists via migrations, append-only audit is enforced by Postgres, and crypto, money, and audit helpers are tested.

**Tasks:**
1. `src/db/schema.ts`: **every table in V§14.1**, exactly as specified. Use `uuid().defaultRandom()`, `timestamp({ withTimezone: true })`, `numeric()` for money and quantity, `text()` with check constraints for enums (`mode`, `status`, `side`, `order_type`, `kind`, `actor`, `executor`). FKs `onDelete: 'cascade'` from `users`, except `webhook_events` (no FK). Indexes:
   - `order_intents(user_id, created_at)`, `order_intents(status, expires_at)`
   - unique `order_intents(user_id, idempotency_key)`
   - unique `accounts(user_id, snaptrade_account_id)`
   - `mcp_tokens(grant_id)`, `audit_events(user_id, created_at)`
2. `drizzle.config.ts` → `npm run db:generate` creates the initial migration.
3. **Custom migration** (`drizzle-kit generate --custom --name audit_guard`) containing the `audit_guard()` function and trigger from **V§14.3**, verbatim.
4. `src/db/migrate.ts`: runs `migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations') })`. Resolve from the **repo root**, not `dist/`, because `tsc` does not copy `.sql` files; Render runs from the repo root so the folder exists. Logs the count, exits 0/1. Uses `DATABASE_URL`, or `TEST_DATABASE_URL` when `MIGRATE_TARGET=test`. If a migration ever fails through Neon's pooler, run it once with the **direct** (non-`-pooler`) connection string and note it in `DECISIONS.md`.
5. `src/lib/crypto.ts`:
   - `encryptField(plaintext, key, aad)`: AES-256-GCM, random 12-byte IV, returns `v1:<b64 iv>:<b64 ct>:<b64 tag>`.
   - `decryptField(blob, key, aad)`: rejects an unknown version prefix and throws on tamper or AAD mismatch.
   - `aadFor(userId, field)` = `${userId}|${field}`.
   - `sha256Hex(s)`, `randomToken(bytes = 32)` (base64url), `safeEqual(a, b)` (`timingSafeEqual` on equal-length buffers; false otherwise).
   - `pkceChallenge(verifier)` = base64url(SHA-256(verifier)).
6. `src/lib/money.ts` (add `npm i big.js && npm i -D @types/big.js` here, not P7): `dec(s)`, `mul(a,b)`, `add`, `cmp`, `roundCents(x)` (half-up, 2 dp), `decimalPlaces(s)`, `isPositive(s)`, `fmtMoney(x, currency)` for display. Decimal strings in and out.
7. `src/lib/time.ts`: `TORONTO = 'America/Toronto'`, `fmtToronto(date)` for display ("Oct 3, 2026, 2:32 PM ET").
8. `src/lib/errors.ts`: `NeedsReauthError`, `NotFoundError`, `ConflictError`, `ValidationError` (each with a safe, user-facing `message`).
9. `src/audit/write.ts`: `writeAudit(tx, { userId, intentId?, actor: 'ai'|'user'|'system', actorDetail?, eventType, details })`. `details` must never contain secrets. Add an assertion helper `assertNoSecrets(details)` that throws if any key matches `/token|secret|code|password|authorization/i`.
10. `tests/helpers/db.ts`: `setupTestDb()` runs migrations once against `TEST_DATABASE_URL`, and `truncateAll()` runs between tests (`TRUNCATE <all tables> RESTART IDENTITY CASCADE`). TRUNCATE does not fire row-level triggers, so the audit guard doesn't block test cleanup, and the app never uses TRUNCATE.
11. Tests:
    - `unit/crypto.test.ts`: round trip; tamper ciphertext → throws; tamper tag → throws; different AAD → throws; wrong key → throws; two encryptions of the same text differ (random IV); `safeEqual`; PKCE known vector (RFC 7636 appendix B: verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).
    - `unit/money.test.ts`: `0.1 × 3 = 0.3` exactly; half-up rounding (`1.005` → `1.01`); decimal-place counting.
    - `integration/audit-guard.test.ts`: UPDATE blocked; DELETE blocked; DELETE allowed inside a transaction with `SET LOCAL app.deleting_user = '<that user id>'`; deleting the user row cascades its audit rows under that setting.

**Checkpoint:**
- [ ] `npm run db:migrate` applies cleanly to Neon, and `MIGRATE_TARGET=test npm run db:migrate` to the test DB
- [ ] All V§14.1 tables exist (`\dt` or a Drizzle introspection check)
- [ ] Audit guard tests pass (update/delete blocked, deletion path allowed)
- [ ] Crypto + money unit tests pass, including the RFC 7636 PKCE vector
- [ ] Commits: `feat(db): add full schema and initial migration` · `feat(audit): enforce append-only audit log with trigger` · `feat(crypto): add aes-gcm field encryption and token helpers` · `feat(db): add decimal money helpers`

---

## PHASE 3 — Sign in with SnapTrade (M1, part 1)

**Goal:** a user can sign in through SnapTrade OIDC. Tokens are stored encrypted and a secure session is created. Every failure path is handled.

**Tasks:**
0. `policy/schema.ts`: `PolicyRulesSchema` (Zod) + `DEFAULT_POLICY`, needed now because the first sign-in inserts the default policy:
   - `allowedSides: ['buy']`
   - `assetTypes: ['cs','et']` (fixed in v1, shown read-only)
   - `orderTypes: ['market','limit']`
   - `maxOrderValue: '100'`, `maxDailyValue: '250'`, `maxOrdersPerDay: 5`
   - `symbolAllowlist: []`, `symbolDenylist: []`
   - `policyCurrency: 'CAD'` (`'CAD'|'USD'`)
   - `approvalWindowMinutes: 10`
   - `schemaVersion: 1`
   Hard ceilings per V§8.2 (per-order ≤ 10,000; daily ≤ 50,000; orders/day 1–50; window 5–30). Money values are decimal strings validated with `big.js` (> 0, ≤ 2 dp). Symbols in lists are uppercased and match `^[A-Z0-9.\-]{1,20}$`.
1. `snaptrade/discovery.ts`: `getSnapTradeMetadata(deps)` fetches `${SNAPTRADE_ISSUER}/.well-known/oauth-authorization-server` **and** `/.well-known/openid-configuration`, Zod-parses the fields we use (`issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint` (from AS metadata), `jwks_uri`), asserts `issuer === SNAPTRADE_ISSUER`, and caches for 24h (in memory, one in-flight promise shared).
2. `snaptrade/oidc.ts`:
   - `buildAuthorizeUrl(meta, { state, nonce, codeChallenge })`: `response_type=code`, `client_id`, `redirect_uri`, `scope` = `openid email read webhook` + (`trade` if `SNAPTRADE_REQUEST_TRADE_SCOPE`), `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`.
   - `exchangeCode(deps, meta, { code, codeVerifier })`: POST form-urlencoded to the token endpoint with `Authorization: Basic base64(id:secret)` and `Accept: application/json`. Zod-parse `{ access_token, refresh_token, expires_in, token_type, scope, id_token }`. Non-2xx throws a safe error (status only, no body in logs).
   - `verifyIdToken(idToken, { getKey, nonce })`: `jose.jwtVerify(idToken, getKey, { issuer, audience: clientId, algorithms: ['RS256'], maxTokenAge: '10m' })`, then `payload.nonce === nonce`. Returns `{ sub, email?, emailVerified? }`.
   - `getKey` is **injected**: production uses `createRemoteJWKSet(new URL(jwks_uri))` created once. Tests use `createLocalJWKSet(fakeJwks)`.
3. `auth/return-to.ts`: `safeReturnTo(input)` returns `input` only if it matches `^/(?![/\\])` and contains no control characters. Otherwise `/dashboard`.
4. `auth/sessions.ts`:
   - Cookie name `__Host-gg_session` when `NODE_ENV=production`, else `gg_session`. Attributes: `HttpOnly; Secure (prod); SameSite=Lax; Path=/`, max-age 24h.
   - `createSession(tx, userId)` → random 32-byte id. Stores `sha256(id)`, a random `csrf_token`, and `expires_at = now + 24h`.
   - `loadSession(c)` sets `c.var.session` and `c.var.user` if valid and unexpired.
   - `requireSession` middleware: no session → redirect to `/login?return_to=<current path>`.
   - `destroySession(c)`.
5. `auth/csrf.ts`: `csrfField(session)` renders a hidden input. `verifyCsrf` middleware for every non-GET route behind a session compares the form's `csrf` with the session token via `safeEqual`. Also apply Hono's built-in `csrf()` (Origin check) globally to form POSTs, **excluding** `/oauth/token`, `/oauth/revoke`, `/mcp`, `/webhooks/*` (machine-to-machine).
6. `auth/login-routes.ts`:
   - `GET /login?return_to=…`: create `login_attempts` (random cookie value `gg_login`, store `sha256(cookie)`, `state`, encrypted `code_verifier` (AAD `login|<attemptId>`), `nonce`, `return_to` (validated), optional `mcp_auth_request_id`, `expires_at = now + 10m`). Set the `gg_login` cookie (HttpOnly, SameSite=Lax, 10 min). 302 to the authorize URL.
   - `GET /oauth/snaptrade/callback`: load the attempt by the `gg_login` cookie hash. If missing, expired, or consumed → error page "Sign-in expired, try again". **Mark it consumed immediately** (single use). If `error` param → "You declined, nothing was stored" page. If `state` ≠ attempt.state → 400 page. Otherwise exchange the code, verify the id_token, then in one transaction:
     - upsert `users` on `snaptrade_sub` (set email + `email_verified`, `needs_reauth=false`)
     - upsert `snaptrade_grants` with **encrypted** access/refresh tokens (AAD `userId|access_token` / `userId|refresh_token`), `access_expires_at = now + expires_in`, `scope`
     - insert the `policies` row with `DEFAULT_POLICY`, `version = 1`, if absent
     - audit `user.signed_in`
     - **destroy any existing session cookie and create a new session**
     Clear the `gg_login` cookie. Redirect to `return_to` (or, if `mcp_auth_request_id` is set, to `/oauth/authorize/resume?request=<id>`, wired in P9).
   - `POST /logout` (CSRF): destroy the session, redirect to `/`.
7. `web/layout.tsx` (nav, footer "Not financial advice. Guardrail Gateway never recommends trades." + Privacy link), `public/styles.css` served via `serveStatic({ root: './public' })` from `@hono/node-server/serve-static` at `/static/*`, `web/pages/home.tsx` (what it is + "Sign in with SnapTrade"), `web/pages/dashboard.tsx` (email + placeholder), `web/pages/error.tsx`.
8. `secureHeaders` middleware globally per V§13 (CSP `default-src 'self'; frame-ancestors 'none'; form-action 'self'` plus `img-src 'self' data:`), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS in production only.
9. `tests/helpers/fake-snaptrade.ts`: a `fetch`-compatible function routing by URL. Generates an RS256 keypair (`jose.generateKeyPair('RS256')`), serves discovery + JWKS, mints id_tokens (`sub`, `aud`, `iss`, `nonce`, `email`, `email_verified`), and implements `/oauth/token/` (authorization_code + refresh_token with **rotation** and **call counter**) and the revocation endpoint. Programmable failures (`nextTokenResponse = { status: 400, body: { error: 'invalid_grant' } }`).
10. `tests/helpers/app.ts`: `buildTestApp({ now })` and `signInTestUser(app)` (drives `/login` → callback against the fake, returns cookies + CSRF token).
11. Tests (`integration/oidc-login.test.ts`):
    - success creates user + grant + session; tokens in DB are `v1:` blobs and decrypt correctly
    - `error=access_denied` → declined page, no user row
    - wrong state → 400, attempt consumed (replaying the same callback fails)
    - missing or expired attempt cookie → error page
    - bad nonce, wrong `aud`, wrong `iss`, bad signature → rejected, no user row
    - session cookie attributes correct; a new session id after login (fixation)
    - `safeReturnTo`: `//evil.com`, `/\evil.com`, `https://evil.com` → `/dashboard`
    - CSRF: POST `/logout` without a token → 403
    - security headers on an HTML page: CSP contains `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`
    - `unit/policy-schema.test.ts`: defaults valid; ceilings enforced; bad decimals and bad symbols rejected

**Checkpoint:**
- [ ] All OIDC integration tests pass
- [ ] **Manual:** `npm run dev`, then sign in at `http://localhost:3000` with the SnapTrade Personal test user → dashboard shows your email
- [ ] Manual: click Deny on the SnapTrade consent screen → friendly declined page
- [ ] Manual: `SELECT access_token_enc FROM snaptrade_grants` shows `v1:…` ciphertext, not a token
- [ ] Logs contain no tokens or codes (search the dev console output)
- [ ] Commits: `feat(policy): add policy schema with strict defaults` · `feat(snaptrade): discover oauth and oidc metadata` · `feat(oidc): sign in with snaptrade using pkce state and nonce` · `feat(auth): add hashed db sessions and csrf protection` · `test(oidc): cover login success and failure paths`

---

## PHASE 4 — Accounts Sync + Dashboard (M1, part 2)

**Goal:** after sign-in, the user's connections and accounts are synced and listed, and the user explicitly allows accounts. A default strict policy exists.

**Tasks:**
1. `snaptrade/api.ts`: `snaptradeFetch(deps, userId, { method, path, query?, body?, retry: 'read'|'none', accountId? })`:
   - Builds `${SNAPTRADE_API_BASE_URL}${path}` (**no `/api/v1`**) with `Authorization: Bearer <access>` from `tokens.getAccessToken(userId)` (P4 version: decrypt; if expired → `NeedsReauthError`. P6 adds refresh).
   - 10s timeout via `AbortSignal.timeout`.
   - `retry: 'read'`: up to 2 retries on 429/5xx/network. The wait comes from `X-RateLimit-Account-Reset` → `X-RateLimit-Reset` → body regex `/available in (\d+) seconds/` → backoff `min(10s, 500ms·2^n)` × random(0..1) (full jitter).
   - Logs `{ method, route (template), status, durationMs, snaptradeRequestId }` only.
   - Non-2xx after retries → typed error with status (no body logged).
2. `snaptrade/resources.ts` (each Zod-parses only the fields used, `.passthrough()` not needed):
   - `listConnections` → `GET /authorizations` → `[{ id, brokerage: { name }, type, disabled, disabled_date }]`
   - `listAccounts` → `GET /accounts` → `[{ id, brokerage_authorization, name, number, institution_name, raw_type, account_category, is_paper, balance? }]`
   - (positions/balances/quotes/symbols arrive in P8. Define stubs only if needed.)
   - **If a response shape differs from the docs, record it in `API_FEEDBACK.md` and adjust the schema.**
3. `snaptrade/cache.ts`: `createTtlCache<K,V>({ ttlMs, now })` with `get`, `set`, `delete`, `deleteWhere(predicate)`, and `getOrLoad(key, loader)` (shares in-flight loads).
4. `snaptrade/sync.ts`: `syncUserConnectionsAndAccounts(deps, userId)`:
   - Upsert `connections` (`type` normalised to `read|trade`, `disabled`, `synced_at`).
   - Upsert `accounts`: new rows get `id = 'acc_' + randomToken(6)` and `allowed=false`, `present=true`. Store `number_last4` only (**never the full number**). Accounts missing from the response get `present=false`.
   - Audit `accounts.synced` with counts.
   - Called after login and from `POST /accounts/refresh`. Cached 5 min (V§12.3).
5. Dashboard (`web/routes.tsx`, `requireSession`):
   - `GET /dashboard`: accounts table (institution, name, raw_type, category, ••••last4, Paper/Real, connection status, Allowed toggle). Banner if any connection is disabled. Banner if `needs_reauth`. MCP URL box with copy instructions. Pending approvals list (empty until P8).
   - `POST /accounts/:ref/allow` (`allowed=true|false`, CSRF, account must belong to the user → else 404). Audit `account.allowed` / `account.disallowed`.
   - `POST /accounts/refresh` (CSRF) runs a forced sync.
6. Tests:
   - `integration/sync.test.ts`: first sync inserts accounts not-allowed with last4 only; second sync with one account missing → `present=false`; connection disabled flag stored.
   - `integration/accounts-allow.test.ts`: toggle works; another user's ref → 404; missing CSRF → 403.
   - `unit/api-retry.test.ts`: 429 with an `X-RateLimit-Account-Reset: 1` header waits ≈1s then succeeds (fake timers); 500 ×3 → error; `retry:'none'` never retries.

**Checkpoint:**
- [ ] Manual: after sign-in, the dashboard lists Sandbox accounts, all **not allowed**
- [ ] Manual: allowing an account persists across reloads
- [ ] DB shows only `number_last4`, never full account numbers
- [ ] API path prefix confirmed with a real call (no `/api/v1`), noted in `DECISIONS.md`
- [ ] All tests pass
- [ ] Commits: `feat(snaptrade): add api client with timeouts and 429 handling` · `feat(sync): sync connections and accounts into db` · `feat(web): list accounts and allow toggles on dashboard`

---

## PHASE 5 — Deploy Early + API Capability Spike (M2)

**Goal:** the app runs on a public HTTPS URL with sign-in working, and the open API questions are answered with evidence.

**Tasks:**
1. Push `main` to GitHub (already public).
2. **Render → New Web Service** from the repo:
   - Runtime Node. Env var `NODE_VERSION=24`.
   - Build `npm ci && npm run build`.
   - Start `node dist/db/migrate.js && node dist/server.js`.
   - Health check path `/health`. Region **Virginia (US East)** (same as Neon).
   - Instance: **Free for now** (switch to Starter in P10/P14, V§15).
   - Env vars = `.env` values, but with `NODE_ENV=production`, `APP_BASE_URL=https://<service>.onrender.com`, and `SNAPTRADE_REDIRECT_URI=https://<service>.onrender.com/oauth/snaptrade/callback`.
3. SnapTrade dashboard → Test OAuth app → **add** the production redirect URI (keep localhost).
4. Sign in on the public URL.
5. `scripts/spike.ts` (manual, real Sandbox, **never in CI**). Takes a `userId`, loads + decrypts the grant from the configured DB, and calls, printing **shapes only** (keys, types, and redacted samples; no account numbers or tokens):
   - `GET /accounts`
   - `GET /accounts/{id}/positions/all`
   - `GET /accounts/{id}/balances`
   - `POST /accounts/{id}/symbols` body `{ "substring": "VFV" }` and `{ "substring": "AAPL" }`
   - `GET /accounts/{id}/quotes?symbols=<universal_symbol_id from search>`
   Record status codes (403/401 would mean OAuth can't use that endpoint).
6. ⛔ **GATE:** write the answers to **V§21 Q3, Q6, Q9, Q11** in `DECISIONS.md` (decision + evidence) and `API_FEEDBACK.md` (surprises), then tell Aaryan. If quotes or symbol search are **not** available to OAuth tokens, apply the documented fallbacks (V§21) **before P8**, and update `PRODUCT_VISION.md` §8.3 accordingly.

**Checkpoint:**
- [ ] `https://<service>.onrender.com/health` → `ok`
- [ ] Sign-in works end to end on the public URL
- [ ] Spike results recorded for Q3, Q6, Q9, Q11 (including exact symbol format for TSX, e.g. `VFV.TO`)
- [ ] Aaryan informed of results and any fallback chosen
- [ ] Commits: `chore(deploy): configure render start with migrations` · `chore(snaptrade): add capability spike script` · `docs: record snaptrade capability spike results`

---

## PHASE 6 — Token Lifecycle (M3)

**Goal:** access tokens refresh safely (one refresh per user, ever), 401s self-heal once, and disconnect revokes for real.

**Tasks:**
1. `snaptrade/tokens.ts`:
   - `getAccessToken(deps, userId)`: decrypt. If `access_expires_at - now > 5 min`, return it. Otherwise call `refresh(userId, { reason: 'expiring', seenAccessTokenHash })`.
   - `refresh(deps, userId, { seenAccessTokenHash })`: transaction → `SELECT … FROM snaptrade_grants WHERE user_id=$1 FOR UPDATE` → if the stored access token's hash ≠ `seenAccessTokenHash`, **or** expiry is now > 5 min away, someone else refreshed: return the stored token. Otherwise POST `grant_type=refresh_token` (Basic auth, form-urlencoded, 10s timeout). On success, write the new access + **new refresh** token + expiry in the same transaction, then commit. On `invalid_grant`: delete the grant row, set `users.needs_reauth=true`, audit `snaptrade.reauth_required`, throw `NeedsReauthError`. On network error: retry **once** with the same refresh token. If that fails, throw (grant kept).
   - `revokeAndDelete(deps, userId)`: POST to `revocation_endpoint` with `token=<refresh>&token_type_hint=refresh_token` (Basic auth). Delete the grant regardless of the result, audit, and return `{ revokedAtSnapTrade: boolean }`.
2. `snaptrade/api.ts`: on a `401`, call `refresh` with the hash of the token used, retry the request **once**. A second 401 marks `needs_reauth` and throws `NeedsReauthError`.
3. `POST /disconnect` (CSRF):
   - `revokeAndDelete`
   - revoke all `mcp_grants` and `mcp_tokens` for the user (tables exist; empty until P9)
   - cancel `PENDING_APPROVAL` intents via the service (exists from P8; until then, a no-op)
   - destroy the session
   - show a "Disconnected" page. If SnapTrade revocation failed: "Also remove Guardrail Gateway in your SnapTrade dashboard."
4. Dashboard banner + "Reconnect" button when `needs_reauth`.
5. Tests (`integration/token-refresh.test.ts`):
   - **Concurrency:** expire the token, fire **10 concurrent** `snaptradeFetch` calls → the fake token endpoint was hit **exactly once**, all 10 succeed, and the DB holds the rotated refresh token.
   - 401 → refresh → retry succeeds; 401 twice → `needs_reauth=true`.
   - `invalid_grant` → grant deleted, `needs_reauth=true`.
   - Disconnect → fake revocation endpoint called with `token_type_hint=refresh_token`, grant row gone, MCP grants revoked, session destroyed.

**Checkpoint:**
- [ ] Concurrency test proves exactly one refresh call
- [ ] Manual (local): set `access_expires_at` to the past in the DB, reload the dashboard → data loads (refresh happened); grant updated
- [ ] Manual: Disconnect → reconnect required; per V§19.2 #10, the old refresh token no longer works (verify with a one-off curl to the token endpoint using a copied old token *before* disconnecting, then after; **don't paste tokens into chat or logs**)
- [ ] Commits: `feat(tokens): add single-flight refresh with row lock` · `feat(snaptrade): refresh once and retry once on 401` · `feat(auth): disconnect revokes snaptrade token` · `test(tokens): prove one refresh under concurrency`

---

## PHASE 7 — Policy Engine + State Machine (M4, pure code)

**Goal:** the two pure modules that decide everything, with exhaustive table-driven tests.

**Tasks:**
1. `policy/types.ts`:
   - `OrderRequest = { side: 'buy'|'sell'; quantity: string; orderType: 'market'|'limit'; limitPrice?: string; mode: 'paper'|'live' }`
   - `PolicyContext = { killSwitch; userMode; account: { allowed, present, isPaper } | null; connection: { disabled, type } | null; grantHasTradeScope; liveEnabled; livePaperOnly; security: { symbol, typeCode, currency } | null; price: { value: string, source: 'quote'|'limit'|'position', asOf } | null; heldQuantity: string; openSellQuantity: string; todayCountedValue: string; todayCountedOrders: number; hasOpenIntents }`
   - `RuleId` union of the 16 ids in V§8.2.
   - `RuleResult = { rule, passed, reason }`.
2. `policy/rules/*.ts`: one pure function per rule, in the order of V§8.2. Each returns a plain-English reason for **both** pass and fail, with money formatted via `fmtMoney`. Examples:
   - pass: "Order value $96.40 CAD is within your per-order limit of $100.00 CAD."
   - fail: "Order value $340.00 CAD exceeds your per-order limit of $100.00 CAD."
   - `mode_allowed` for live checks all gates (V§10.3) **and** `order.mode === userMode`.
   - `quantity_valid`: > 0, ≤ 6 dp, whole number if live.
   - `price_available` fails if `price` is null.
   - Value rules **pass vacuously** when no price is available (the price rule already failed); the reason says "skipped: no price".
3. `policy/evaluate.ts`: runs **all** rules (no short-circuit). Returns `{ pass: results.every(r => r.passed), results, estimatedValue }`, where `estimatedValue = roundCents(quantity × price)` or null.
4. `policy/describe.ts`: `describePolicy(rules, state)` → short plain-language bullet list for `get_policy` and the dashboard.
5. `intents/state-machine.ts`: `type IntentState` (13 states), `type IntentEvent` (17 events), `TRANSITIONS: Record<IntentState, Partial<Record<IntentEvent, IntentState>>>` exactly as V§7.2. `transition(state, event)` returns the next state or throws `TransitionError(state, event)`. Also export `TERMINAL_STATES`, `COUNTED_STATES` (V§8.3), `OPEN_SELL_STATES` (V§8.2 rule 6).
6. Tests:
   - `unit/policy-rules.test.ts`: **for each of the 16 rules**, at least one passing and one failing case (table-driven), plus boundary cases: value exactly at the limit passes, one cent over fails; daily count exactly at the limit; fractional quantity in live fails, in paper passes; sell more than held − open sells fails; currency mismatch fails; type `oef` fails; denylist beats allowlist; empty allowlist allows all.
   - `unit/evaluate.test.ts`: multiple failures are all reported; `pass` is false if any fail; estimated value rounding.
   - `unit/state-machine.test.ts`: iterate **all 13 × 17 = 221 pairs**. Exactly the 17 in V§7.2 succeed with the right target; all others throw. Terminal states accept no events.
   - Coverage: `vitest run --coverage` on `src/policy/**` and `src/intents/state-machine.ts` → **100% branches** (add `@vitest/coverage-v8` as a dev dependency here).

**Checkpoint:**
- [ ] 221-pair state-machine test passes; exactly 17 valid transitions
- [ ] Every rule has pass + fail + boundary tests
- [ ] 100% branch coverage on policy + state machine
- [ ] No I/O imports in `src/policy/**` or `state-machine.ts` (check: no `db`, `fetch`, or `deps` imports)
- [ ] Commits: `feat(policy): add pure rule functions and evaluate` · `feat(intents): add pure order intent state machine` · `test(policy): table-driven tests for every rule and transition`

---

## PHASE 8 — Intents, Approvals, Paper Executor (M5)

**Goal:** the complete propose → approve → paper fill flow, race-free and audited, runnable without any AI.

**Tasks:**
1. `snaptrade/resources.ts` additions (Zod, only used fields):
   - `getPositions(accountId)` → `GET /accounts/{id}/positions/all` → normalise to `[{ symbol, kind, units, price, currency }]` (kinds `stock`/`etf` kept, others summarised).
   - `getBalances(accountId)` → `[{ currency, cash, buying_power? }]`.
   - `searchSymbols(accountId, substring)` → `POST /accounts/{id}/symbols` `{ substring }` → `[{ id, symbol, raw_symbol, description, currency.code, exchange.code?, type.code }]`.
   - `getQuotes(accountId, universalSymbolIds[])` → `GET /accounts/{id}/quotes?symbols=<ids>` → `[{ id, last_trade_price, bid_price, ask_price }]`.
   - Caches per V§12.3. Use the P5 spike's real field names.
2. `intents/symbols.ts`: `resolveSymbol(deps, userId, accountId, ticker)`. Uppercase; validate against `^[A-Z0-9.\-]{1,20}$`; search; keep results whose `symbol` **or** `raw_symbol` equals the ticker exactly. 0 → `{ ok:false, reason:'Unknown symbol…' }`. >1 → `{ ok:false, reason:'Ambiguous…', candidates }`. 1 → `{ ok:true, security }`. Cache 24h.
3. `intents/context.ts`:
   - `prefetch(deps, user, account, order, security)` runs **outside the lock**: quote (market orders; limit orders use the limit price), positions (for sells and the paper ledger), connection freshness (refresh `/authorizations` if > 5 min old).
   - `dbCounts(tx, userId, now, currency, excludeIntentId?)` runs **inside the lock**: today's counted value and orders (V§8.3 SQL with `$now`), open sell quantity, `hasOpenIntents`.
4. `intents/service.ts` (every state change = `transition()` + `UPDATE … WHERE id AND status=$current` (expect 1 row) + `writeAudit` in the **same transaction**). All public functions take `deps`:
   - `proposeOrder(deps, { userId, grantId, accountRef, symbol, side, quantity, orderType, limitPrice?, idempotencyKey? })`:
     - Validate input.
     - Idempotency: if the key exists → same fingerprint returns the existing intent, a different one throws `ConflictError`.
     - Resolve the account (must be the user's).
     - Resolve the symbol. Unknown or ambiguous is an **input** problem, not a policy decision: return `{ status: 'INVALID_INPUT', reason, candidates? }` and create **no** intent (audit `intent.input_rejected` with the reason, actor `ai`).
     - If prefetch fails (`NeedsReauthError`, SnapTrade unreachable after retries): return a clear error result, create **no** intent.
     - Prefetch.
     - Transaction: lock the user row → `dbCounts` → `evaluate` → insert the intent as `PROPOSED` → transition to `PENDING_APPROVAL` or `POLICY_REJECTED` → set `expires_at = now + approvalWindowMinutes` (pending only) → store `check_results`, `est_*`, `price_source`, `price_as_of`, `policy_version`, `mode = user.mode` → audit (actor `ai`, detail = client host).
     - After commit: if pending, `sendApprovalEmail` (best effort).
     - Return a DTO with `approvalUrl = ${APP_BASE_URL}/approvals/${id}`.
   - `expireDue(tx, userId | null, now)`: `PENDING_APPROVAL` with `expires_at <= $now` → `EXPIRED` (+ audit each). Called at the start of every intent read and approval, and by the sweeper.
   - `approveIntent(deps, { userId, intentId })`:
     - Load the intent (must be the user's, else `NotFoundError`).
     - Prefetch fresh context. **If prefetch fails** (`NeedsReauthError`, SnapTrade down), nothing changes: the intent stays `PENDING_APPROVAL` and the page shows "Couldn't get a fresh price from your broker. Try again (or reconnect SnapTrade)". Never approve on stale data.
     - Transaction: lock user → lock intent `FOR UPDATE` → `expireDue` → status must be `PENDING_APPROVAL` (else return the current state, no error page crash) → `USER_APPROVED` (audit actor user) → `dbCounts` (exclude self) → `evaluate` → fail: `RECHECK_FAILED` → `POLICY_REJECTED` (store new results); pass: `RECHECK_PASSED` → `EXECUTING` → **paper:** `PaperExecutor.execute` inside the same transaction → `PAPER_FILLED`/`PAPER_NOT_MARKETABLE` → commit.
     - **Live** (P13): commit at `EXECUTING`, then execute outside the transaction.
   - `denyIntent`, `cancelIntent(actor: 'user'|'ai')` (only `PENDING_APPROVAL`; already `CANCELLED` → return as is), `setKillSwitch(on)` (lock user; on → cancel all pending; audit), `setMode(mode)` (lock user; live only if all server/user gates pass; audit).
   - `getIntent`, `listRecentIntents(limit)`. Both call `expireDue` first.
5. `executors/executor.ts`: the interface (V§6.5). `executors/paper.ts`: market fills at the approval price; limit fills only if marketable (buy: price ≤ limit; sell: price ≥ limit) at the fresh price, else `CLOSED`. Upsert `paper_positions` (new avg cost = (oldQty·oldAvg + qty·price)/(oldQty+qty) for buys; sells reduce quantity, avg unchanged), update `paper_cash` (`-value` buys, `+value` sells), insert `executions` (`executor='paper'`, `filled_quantity`, `avg_fill_price`).
6. `approvals/routes.tsx` (`requireSession`; return path preserved through login):
   - `GET /approvals/:id`: the page per **V§9.2**, every listed element, including the source label, SnapTrade disclaimer text, "Fees: None (simulated)" in paper, "proposed by <client host>", duplicate warning (another `PENDING_APPROVAL` intent with the same fingerprint), and expiry as a Toronto clock time. Terminal or expired intents show their outcome without buttons. **GET never changes state** (it may run `expireDue`, which only reflects time).
   - `POST /approvals/:id/approve` and `/deny` (CSRF) → service → redirect back to `GET /approvals/:id` (shows the result).
   - Unknown id or another user's intent → **404**.
7. `approvals/email.ts`: `sendApprovalEmail(deps, user, intent)`. Requires `RESEND_API_KEY` + `EMAIL_FROM` + `user.email_verified`. POST `https://api.resend.com/emails` with `{ from, to, subject, text }`, `Authorization: Bearer <key>`, 10s timeout. Subject per V§9.3, plain text with summary + expiry + link. Otherwise log `email.skipped` (reason only). Failures are logged, never thrown.
8. Dashboard: **Pending approvals** list (links), **Intent history** page `GET /intents` (last 50), `POST /intents/:id/cancel` (user cancel, CSRF).
   Wire **P6's `POST /disconnect`** to cancel all `PENDING_APPROVAL` intents (actor `system`, reason "disconnected").
9. `jobs/sweeper.ts`: `runSweepOnce(deps)` = `expireDue(null, now)` + purge expired sessions, login attempts, and MCP auth requests and codes. `startSweeper(deps)` runs every 60s with an overlap guard (skip if the previous run is still going). Started in `server.ts`, stopped on shutdown.
10. `scripts/demo-flow.ts`: against the **test DB + fake SnapTrade**, in-process: sign in a fake user, allow an account, propose (buy 1 share @ fake price), approve, print the final intent + audit trail. Run with `npx tsx scripts/demo-flow.ts`.
11. Tests (`integration/intents.test.ts`, `integration/approvals.test.ts`):
    - propose passes → `PENDING_APPROVAL` with approval URL; propose failing two rules → `POLICY_REJECTED` with both reasons
    - idempotency: same key + same order → same id; same key + different qty → conflict
    - **double approve** (two concurrent `approveIntent`) → exactly one execution row, one `FILLED`
    - **two different pending intents** that each fit but together exceed the daily limit: approve both concurrently → exactly one fills, the other `POLICY_REJECTED`
    - expiry: advance the clock 11 min → approve fails, state `EXPIRED`
    - kill switch on → pending cancelled; new propose rejected by `kill_switch_off`; approve of a stale page → rejected
    - mode switch paper→live between propose and approve → recheck fails (`mode_allowed`)
    - paper limit not marketable → `CLOSED`; paper sell reduces paper position; no-short rule blocks oversell
    - approval page: logged out → redirect to `/login?return_to=/approvals/<id>`; other user → 404; POST without CSRF → 403; GET never changes status
    - every state change has a matching audit row (count transitions = count audit events of type `intent.*`)
    - approve while the fake SnapTrade returns 500 for quotes → intent still `PENDING_APPROVAL`, friendly message, no execution row
    - propose with an unknown or ambiguous symbol → `INVALID_INPUT` with candidates, no intent row
    - disconnect cancels pending intents

**Checkpoint:**
- [ ] `npx tsx scripts/demo-flow.ts` prints propose → `PENDING_APPROVAL` → `FILLED` with the audit trail
- [ ] All concurrency, expiry, kill-switch, idempotency, and approval-page tests pass
- [ ] Manual: propose via the demo script against the dev DB, approve in the browser, see the paper position on the dashboard
- [ ] Approval page shows every V§9.2 element (manual checklist)
- [ ] Commits: `feat(snaptrade): add positions balances quotes and symbol search` · `feat(intents): propose orders with idempotency and policy checks` · `feat(approvals): add approval page with csrf post actions` · `feat(paper): simulate fills in paper ledger` · `feat(jobs): add sweeper for expiry and cleanup` · `test(intents): cover races expiry kill switch and idempotency`

---

## PHASE 9 — Our OAuth Authorization Server for MCP Clients (M6, part 1)

**Goal:** Claude can register (CIMD), get user consent, and obtain audience-bound tokens from us. Every OAuth edge case is tested.

**Install:** `npm i @modelcontextprotocol/server @modelcontextprotocol/hono` (v2.x; confirm `zod@4` peer compatibility).

**Tasks:**
1. `oauth-server/metadata.ts`: routes exactly per **V§11.3 Metadata**:
   - `/.well-known/oauth-protected-resource`
   - `/.well-known/oauth-protected-resource/mcp`
   - `/.well-known/oauth-authorization-server`
   `issuer = APP_BASE_URL` (no trailing slash), `resource = APP_BASE_URL + '/mcp'`. JSON, `Cache-Control: max-age=300`.
2. `oauth-server/cimd.ts`:
   - `fetchClientMetadata(deps, clientIdUrl)`: `https:` only, host ∈ `MCP_ALLOWED_CLIENT_HOSTS`, URL has a path, `redirect: 'error'`, 5s timeout, reject > 64 KB (read the stream with a byte counter), JSON. Zod `{ client_id, client_name, redirect_uris: string[] (min 1), token_endpoint_auth_method? }`. Require `client_id === clientIdUrl`. Cache honouring `Cache-Control: max-age`, clamped to [5 min, 24 h].
   - `redirectUriAllowed(requested, registered[])`: exact match, **or** both loopback (`localhost`, `127.0.0.1`, `[::1]`) with the same scheme, host, path, and query, ignoring the port.
   - Log the client_id URL of every successful fetch (`oauth.client_seen`) to answer V§21 Q5.
3. `oauth-server/authorize.ts`:
   - `GET /oauth/authorize`: steps 1–6 of V§11.3 **in order**. Errors before the client and redirect are validated render our error page (never redirect). Afterwards, errors redirect with `error`, `state`, `iss`. Persist `mcp_auth_requests` (10 min). If there's no session, redirect to `/login?mcp_request=<id>` (the login route stores `mcp_auth_request_id` on the attempt; the callback sends the user to `/oauth/authorize/resume?request=<id>`).
   - `GET /oauth/authorize/resume?request=<id>` (`requireSession`): load the request, which must be unexpired. Render consent.
   - **Consent page:** requester = **host of client_id**, redirect host, loopback warning, plain statement of the permissions, and "orders always need your approval here". Approve/Deny forms (CSRF + request id).
   - `POST /oauth/authorize/decision`:
     - Deny → redirect `error=access_denied&state&iss`.
     - Approve → reuse the user's **active** (non-revoked) `mcp_grants` row for this `client_id`, or insert a new one. **Revoked grants are never reactivated**, so their old tokens stay dead → code = `randomToken(32)`, store `sha256` + `redirect_uri` + `code_challenge` + `scope` + `resource`, expires **60s** → audit `mcp.grant_approved` → 302 `redirect_uri?code&state&iss`.
4. `oauth-server/token.ts`: `POST /oauth/token`, **form-urlencoded only** (415 otherwise). **No outbound network calls.** Both grants per V§11.3:
   - `authorization_code`: lock the code row, `used_at` null, unexpired, `client_id` matches the grant, `redirect_uri` equal, `resource` (if sent) equal, PKCE `safeEqual(pkceChallenge(code_verifier), code_challenge)`. If **reused**, revoke the grant (all tokens) and return `invalid_grant`. Issue access (1h) and refresh (30d) **only if `offline_access` was granted**. Store hashes with `kind`, `scope`, `resource`, `expires_at`. Response `{ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token?, scope }` with `Cache-Control: no-store`.
   - `refresh_token`: lock the token row. If `used_at` is set → **reuse detected**: revoke the grant, return `invalid_grant`. Otherwise mark it used and issue a new access + refresh **in the same transaction**. `client_id` must match the grant.
   - Errors: `{ error, error_description }` with status 400 (`invalid_request`, `invalid_grant`, `invalid_client`, `unsupported_grant_type`, `invalid_scope`).
5. `oauth-server/revoke.ts`: `POST /oauth/revoke` (form) → find the token by hash → revoke its grant (and all grant tokens). Always 200.
6. `oauth-server/verify.ts`: `verifyAccessToken(deps)(token)` → hash lookup `kind='access'`, not revoked, not expired, grant not revoked, user exists → `AuthInfo { token, clientId, scopes, expiresAt (seconds), resource: new URL(resource), extra: { userId, grantId, clientHost } }`. Update `mcp_grants.last_used_at` at most once per minute. Throw the SDK `OAuthError(InvalidToken)` otherwise (check the SDK v2 export names in `node_modules`).
7. Per-IP rate limit (`lib/ratelimit.ts`, 30/min) on `/oauth/*` and `/login`.
8. Dashboard **Connected AI apps** `GET /apps` (client host, created, last used) + `POST /apps/:id/revoke` (CSRF, audit).
9. Tests (`integration/oauth-server.test.ts`, with a fake CIMD host served by the injected `fetch`):
   - metadata documents exact
   - happy path: authorize → login → consent → code → token → verify OK
   - CIMD: host not allowlisted → error page (no redirect); `client_id` mismatch in the doc → error; redirect not registered → error page; loopback with a different port → allowed; `localhost.evil.com` → rejected
   - missing PKCE / `plain` method / missing state / wrong resource → errors per V§11.3
   - code expired (61s) → `invalid_grant`; code reused → `invalid_grant` **and** the first token is now revoked
   - wrong `code_verifier` → `invalid_grant`
   - refresh rotation works; reuse of an old refresh → grant revoked
   - no `offline_access` → no refresh token
   - token endpoint with a JSON body → 415
   - revoke endpoint revokes; dashboard revoke revokes
   - `verifyAccessToken`: expired / revoked / wrong-resource tokens rejected

**Checkpoint:**
- [ ] All OAuth server tests pass
- [ ] `curl https://<host>/.well-known/oauth-authorization-server` shows `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported: ["none"]`
- [ ] Token endpoint responds in < 200ms locally (no outbound calls)
- [ ] Commits: `feat(oauth-server): publish protected resource and as metadata` · `feat(oauth-server): validate cimd clients and redirect uris` · `feat(oauth-server): add consent and code issuance` · `feat(oauth-server): issue rotating opaque tokens with pkce` · `feat(web): list and revoke connected ai apps` · `test(oauth-server): cover pkce cimd rotation and reuse`

---

## PHASE 10 — MCP Server + Tools (M6, part 2)

**Goal:** Claude (web and Claude Code) connects, lists accounts, proposes an order, the user approves in the browser, and Claude sees `FILLED`.

**Install (dev):** `npm i -D @modelcontextprotocol/client`.

**Tasks:**
1. Read the installed SDK v2 docs/types for: `createMcpHandler`, `McpServer.registerTool` (input/output schemas, annotations), how handlers read `ctx.http.authInfo`, `requireBearerAuth` (web-standard) options (`verifier`, `requiredScopes`, `resourceMetadataUrl`, `expectedResource`), host/origin validation helpers, and `responseMode: 'json'`. Note anything surprising in `DECISIONS.md`.
2. `mcp/handler.ts`:
   - `gate = requireBearerAuth({ verifier: { verifyAccessToken }, requiredScopes: ['mcp'], resourceMetadataUrl: APP_BASE_URL + '/.well-known/oauth-protected-resource/mcp', expectedResource: new URL(APP_BASE_URL + '/mcp') })`
   - `handler = createMcpHandler(({ authInfo }) => buildServer(deps, authInfo), { responseMode: 'json' })`
   - route `app.all('/mcp', …)`: Host-header validation for the public host (SDK helper) → `gate(c.req.raw)` (Response → return it) → per-user rate limit (60/min overall; `propose_order` 10/min, checked inside the tool) → `handler.fetch(c.req.raw, { authInfo, parsedBody })`.
   - Server identity `{ name: 'guardrail-gateway', version: <package.json version> }`.
3. `mcp/tools/*.ts`: the 8 tools in **V§11.2**, registered in that fixed order. Each tool:
   - Zod input schema (strict; `quantity`/`limit_price` as decimal strings or numbers, normalised to strings; `idempotency_key` UUID; `account_ref` `^acc_[A-Za-z0-9_-]+$`).
   - Output schema + `structuredContent` + a short text summary in `content`.
   - Annotations per the V§11.2 table, `openWorldHint: false`.
   - Description ends with the mandatory human-approval sentence (V§11.2).
   - Business outcomes are normal results. Only invalid input or system errors use `isError: true`.
   - `NeedsReauthError` → normal result with the reconnect message (V§11.2).
   - Uses only `authInfo.extra.userId`. **Never** trusts a user id from tool input.
   - Returns only V§11.2 fields (`account_ref`, last4, no SnapTrade ids, no tokens).
4. Tool behaviours:
   - `list_accounts`: allowed + present accounts only.
   - `get_positions`: real positions (cached) + paper positions when the user is in paper mode, labelled `"source":"paper"`.
   - `get_balances`: cash per currency.
   - `get_policy`: `describePolicy` + mode + kill switch + remaining today (value and orders).
   - `propose_order`: `proposeOrder` with `grantId` from authInfo; returns the DTO incl. `approval_url`.
   - `get_order_status`: `getIntent` (also triggers live tracking in P13).
   - `list_recent_intents`: limit 1–20, default 10.
   - `cancel_order_intent`: `cancelIntent(actor:'ai')`.
5. `GET /dashboard` MCP box: exact connector URL + steps for Claude (Settings → Connectors → Add custom connector → paste URL) and Claude Code (`claude mcp add --transport http guardrail <url>`).
6. Tests (`integration/mcp.test.ts`, using `@modelcontextprotocol/client` with `fetch` wired to `app.fetch`):
   - no token → HTTP 401 with `WWW-Authenticate` containing `resource_metadata=`
   - valid token: `tools/list` returns exactly the 8 tools in order with annotations; no approve/policy/kill-switch tool exists
   - `propose_order` → pending + `approval_url`; then `approveIntent` via HTTP as the user → `get_order_status` = `FILLED`
   - `propose_order` for a non-allowed account → normal result with the reason; for another user's `account_ref` → not found
   - tool input with an extra `user_id` field → rejected or ignored, never used
   - revoked grant → 401
   - rate limit: the 11th `propose_order` in a minute → rate-limit error result
7. ⛔ **GATE (V§21 Q5):** connect from **Claude web** and **Claude Code** against the deployed URL. Read the `oauth.client_seen` logs to confirm the hosted-Claude `client_id` URL host is allowlisted. If CIMD fails, stop and tell Aaryan. The DCR fallback per V§11.3 is a scoped mini-phase.
8. Switch the Render instance to **Starter (always-on)** before real Claude testing (V§0 C6), so OAuth endpoints answer within Claude's 10s limits.

**Checkpoint:**
- [ ] MCP integration tests pass
- [ ] MCP Inspector (`npx @modelcontextprotocol/inspector`) connects to the deployed URL via OAuth and lists 8 tools
- [ ] **Claude web:** add the custom connector → consent → "list my accounts" works
- [ ] **Claude web:** "buy 1 share of <sandbox symbol> in <account>" → pending + link → approve in browser → ask Claude for status → `FILLED`
- [ ] **Claude Code:** same connect + list flow via loopback redirect
- [ ] Revoking the app on the dashboard → Claude's next call fails and asks to reconnect
- [ ] Commits: `feat(mcp): mount sdk v2 handler behind bearer gate` · `feat(mcp): add read-only account and policy tools` · `feat(mcp): add propose status list and cancel tools` · `test(mcp): end-to-end tool flow through mcp client`

---

## PHASE 11 — Dashboard Polish (M7)

**Goal:** every user control from V§6.6 works, and every setting demonstrably changes behaviour.

**Tasks:**
1. **Policy editor** `GET/POST /policy` (CSRF): all editable fields from `PolicyRulesSchema` (sides, max order value, max daily value, max orders/day, allowlist, denylist (comma-separated, uppercased, validated), policy currency (blocked with a message if `hasOpenIntents`), approval window). On save: lock the user, bump `version`, audit `policy.updated` with before/after, and show a success message. Read-only display of the fixed rules (asset types, order types, approval always required).
2. **Kill switch** `POST /kill-switch` (`on|off`, CSRF) → `setKillSwitch`. A big visible state on every page header. When on, list `SUBMITTED`/`UNKNOWN` live orders with the "cancel at your broker" notice (V§4.6).
3. **Mode** `POST /mode` (CSRF) → `setMode`. The live option is disabled with the exact failing gate(s) listed (V§10.3).
4. **Audit log** `GET /audit`: last 100 events, newest first. Actor, actor detail, event type, intent link, time (Toronto). Details rendered as escaped key/values.
5. **Delete account** `GET /account/delete` (explains what's deleted) + `POST /account/delete` (CSRF + typed confirmation `DELETE`):
   - best-effort `revokeAndDelete`
   - then one transaction: `SET LOCAL app.deleting_user = <id>`, `DELETE FROM webhook_events WHERE user_sub = <sub>` (no FK, so it must be deleted explicitly), `DELETE FROM users WHERE id=$1` (cascade)
   - destroy the session → goodbye page (with "also remove the app in SnapTrade" if revocation failed)
6. **Privacy page** `GET /privacy` (public): what we store (V§13 Privacy row), why, retention (webhooks 30d, sessions 24h, everything else until deletion), how to delete, no brokerage credentials, SnapTrade handles brokerage logins. Linked from every page footer.
7. Not-financial-advice notice on the home, dashboard, approval, and consent pages.
8. Tests (`integration/dashboard.test.ts`):
   - policy save changes evaluation (lower max → next propose rejected)
   - denylist blocks; allowlist restricts
   - currency change blocked with open intents
   - kill switch on/off round trip; mode live blocked with gate reasons (env `LIVE_TRADING_ENABLED=false`)
   - **account deletion leaves zero rows** in every user-linked table (query each table by user id, and `webhook_events` by `user_sub`) and the audit trigger allowed it
   - all POSTs require CSRF; all pages require a session except `/`, `/privacy`, and `/login`

**Checkpoint:**
- [ ] Manual checklist: each setting changes behaviour as expected (try each in the browser + one propose)
- [ ] Account deletion test proves zero remaining rows
- [ ] Privacy page reachable logged out
- [ ] Commits: `feat(web): add policy editor with audit trail` · `feat(web): add kill switch and mode controls` · `feat(web): add audit log view` · `feat(web): add account deletion and privacy page` · `test(web): cover dashboard settings and deletion`

---

## PHASE 12 — Webhooks (M8)

**Goal:** signed SnapTrade webhooks are verified, deduplicated, and processed asynchronously as "re-sync" hints. Connection health gates proposals.

**Tasks:**
1. `webhooks/canonical-json.ts`: `canonicalJson(value)`. Recursively sorted object keys; separators `,` `:`; strings escaped like Python `json.dumps` with default `ensure_ascii=True` (`"`, `\\`, `\n`, `\r`, `\t`, `\b`, `\f`, other control chars `\u00XX`, all non-ASCII as `\uXXXX` using UTF-16 code units, lowercase hex); numbers via `JSON.stringify` (document: Python float formatting can differ for exotic floats, and SnapTrade payloads are strings/ints); `true/false/null`.
2. `webhooks/verify.ts`: `verifySignature(rawBody, signatureHeader, consumerKey)` → parse → canonical → HMAC-SHA256 → base64 → `safeEqual`.
3. `webhooks/routes.ts`: `POST /webhooks/snaptrade` **exactly per V§12.4 steps 1–6** (64 KB cap, 400 non-JSON, 401 bad signature with nothing stored, Zod after verification, foreign `oauthClientId` → 200 ignore, compute stale, insert with `ON CONFLICT DO NOTHING`, 200 immediately, then `queueMicrotask(() => processPending(deps))`). No per-IP rate limit on this route.
4. `webhooks/processor.ts`: `processPending(deps)` picks unprocessed rows (`FOR UPDATE SKIP LOCKED`, batch 20), finds the user by `user_sub` (unknown user, or user with `needs_reauth`/no grant → mark processed with `last_error='skipped: no active grant'`), applies the V§12.4 step-6 actions (re-sync via `syncUserConnectionsAndAccounts`, cache invalidation), and debounces stale events (≤ 1 re-sync per user per 5 min). Sets `processed_at`, or on error increments `attempts` + `last_error` (no secrets; give up after 5).
5. Sweeper: also call `processPending`, and purge `webhook_events` older than 30 days.
6. Dashboard banner for disabled connections (already from P4) is now driven by webhooks too. `NEW_ACCOUNT_AVAILABLE` → "New account found — not allowed yet" notice.
7. **Configure the webhook URL** in the SnapTrade dashboard (Webhooks section): `https://<host>/webhooks/snaptrade`.
8. Tests:
   - `unit/canonical-json.test.ts`: key order nested; compact separators; `é` → `é`; emoji → surrogate pair escapes; control chars. **Cross-check vectors:** generate expected strings once with Python (`python -c "import json;print(json.dumps(obj,sort_keys=True,separators=(',',':')))"`) and hard-code them in the test.
   - `integration/webhooks.test.ts`: valid signed → 200, stored, processed (connection marked disabled → `connection_healthy` now fails a propose); bad signature → 401, nothing stored; duplicate `webhookId` → 200, one row; stale → 200, `stale=true`, re-sync debounced; foreign client id → 200 ignored; non-JSON → 400; oversize → 413.
   - ⛔ **Real fixture:** capture one real Sandbox webhook (add/remove a connection in the SnapTrade Personal dashboard) from the deployed app's logs (body logged **once** in a temporary debug mode, with no secrets), save it to `tests/fixtures/webhook-real.json` with its signature, and assert verification passes. If it fails → investigate canonicalisation, record in `API_FEEDBACK.md`, tell Aaryan (V§21 Q8).

**Checkpoint:**
- [ ] Signed fixture accepted; unsigned/tampered → 401; duplicate ignored; stale flagged
- [ ] **Real** SnapTrade Sandbox webhook verifies on the deployed URL
- [ ] `CONNECTION_BROKEN` (fixture) blocks proposals for that connection's accounts
- [ ] Commits: `feat(webhooks): add python-compatible canonical json` · `feat(webhooks): verify signature and store events idempotently` · `feat(webhooks): process events as resync hints` · `test(webhooks): cover signature dedupe stale and real fixture`

---

## PHASE 13 — Live Executor (M9) — ⛔ only if SnapTrade enabled `trade`

**Precondition gate:** SnapTrade confirmed `trade` for the Test app **and** a trade-enabled connection with an `is_paper=true` account exists (V§21 Q1, Q2). If not, **skip to P14** and keep live gated off. That's a complete v1.

**Tasks:**
1. Set `SNAPTRADE_REQUEST_TRADE_SCOPE=true`. The user re-authorizes (scopes are per grant). Persisted `scope` contains `trade`.
2. `snaptrade/resources.ts`: `placeOrder(accountId, body)` (`POST /trade/place`, `retry:'none'`, 15s timeout), `getOrderImpact(body)` (`POST /trade/impact`, `retry:'none'`), `getRecentOrders(accountId)` (`GET /accounts/{id}/recentOrders?only_executed=false`).
3. `executors/snaptrade.ts`: V§10.3 steps 2–3. Body `{ account_id, action: BUY|SELL, symbol: <resolved broker symbol>, universal_symbol_id: null, order_type: 'Market'|'Limit', time_in_force: 'Day', units, price (limit only), client_order_id: intent.id }`. Map outcomes: 2xx → `BROKER_ACCEPTED` (store `brokerage_order_id`, `submitted_at`); 4xx → `BROKER_REJECTED` (sanitised message); timeout/5xx/network → `OUTCOME_UNKNOWN`. Write the result in its own transaction with audit.
4. `approveIntent` live branch: commit at `EXECUTING`, then call the executor, then the result transaction. At most one live order per second per account (in-memory guard).
5. Tracking in the sweeper (V§10.3 step 4): per account with `SUBMITTED`/`UNKNOWN` intents, poll recent orders no faster than every 15s (30 min), then every 5 min until end of the Toronto day. Map statuses. Partial fills update `filled_quantity`. `get_order_status` triggers a check (respecting the 15s floor).
6. `UNKNOWN` reconciliation (V§10.3 step 5): match account + symbol + side + quantity within ±10 min of `submitted_at`/`updated_at`; exactly one → `RECONCILED_FOUND`. The UI button "It was not placed" (`POST /intents/:id/not-placed`, CSRF) → `USER_CONFIRMED_NOT_PLACED`.
7. Startup + sweeper: live `EXECUTING` older than 2 min → `OUTCOME_UNKNOWN`.
8. Approval page in live mode: big red **LIVE** badge; call `getOrderImpact` on GET (best effort, 5s timeout). Show "Brokerage preview" fields if returned, else "Not available" + the unavailable-impact disclaimer (V§9.2). Fees never `$0.00` unless the preview says so.
9. Tests (fake SnapTrade): accepted → `SUBMITTED` → poll `EXECUTED` → `FILLED`; 400 → `FAILED`; timeout → `UNKNOWN` → reconciled → `SUBMITTED`; `UNKNOWN` + user "not placed" → `FAILED`; **no automatic retry of `/trade/place` ever** (call counter = 1); gates: `LIVE_TRADING_ENABLED=false` blocks, non-paper account blocked when `LIVE_TRADING_PAPER_ACCOUNTS_ONLY=true`, missing trade scope blocks; crash simulation (`EXECUTING` older than 2 min) → `UNKNOWN`.
10. Manual on the **paper brokerage account only**: one market buy, observe `SUBMITTED` → `FILLED`. **Never real money.**

**Checkpoint:**
- [ ] All live-executor tests pass (including "place called exactly once")
- [ ] Manual paper-account order reaches `FILLED` (or `CLOSED`) via tracking
- [ ] Gates verified: live impossible on a non-paper account with default env
- [ ] Commits: `feat(live): place orders via snaptrade with client order id` · `feat(live): track submitted orders and reconcile unknown` · `feat(approvals): show brokerage preview in live mode` · `test(live): cover outcomes gates and no-retry rule`

---

## PHASE 14 — Submission Polish (M10)

**Goal:** a stranger understands, trusts, and can try the project in 60 seconds. Every decision is documented.

**Tasks:**
1. `README.md`: one-paragraph pitch · 60-second try-it (connector URL + steps, or watch the demo video) · architecture diagram (V§6.1) · two OAuth relationships · guardrail list · tradeoffs (V§22) · known limits (paper-only if P13 skipped, single instance, no FX, no broker cancel, Render cold start only on free) · local setup (`.env.example`, Docker test DB, `npm test`) · "Not financial advice."
2. `DECISIONS.md` complete (every V§0 item + anything decided during the build).
3. `API_FEEDBACK.md` complete (every SnapTrade surprise + workaround), written as constructive feedback to SnapTrade.
4. `THREAT_MODEL.md`: assets, attackers (malicious content → prompt injection, stolen MCP token, phishing client, webhook forger, CSRF/clickjacking, insider DB read), mitigations → V§13.
5. Demo video script (2–3 min) in `docs/demo-script.md`: sign in → allow account → policy → connect Claude → propose rejected (over limit) → propose OK → approve → FILLED → kill switch → audit log.
6. Final pass: re-run the full V§19.2 manual checklist on the deployed URL, a fresh sign-up with a second test user, confirm the Render instance is **Starter**, and confirm test-app user slots are free for reviewers.
7. Tag `v1.0.0`.

**Checkpoint:**
- [ ] README lets a stranger understand the project without other files
- [ ] V§19.2 manual checklist fully ticked on production
- [ ] CI green on `main`, tag `v1.0.0` pushed
- [ ] Commits: `docs: write readme with architecture and tradeoffs` · `docs: complete decisions api feedback and threat model` · `docs: add demo video script`

---

## Cross-verification log (how this file was checked)

Pass 1: every V§ requirement → mapped to the phase that builds it and the test that proves it:

| Requirement (V§) | Built in | Proven by |
|---|---|---|
| Env validation, origin match (G15) | P1 | `env.test.ts` |
| Schema V§14.1, audit trigger V§14.3 | P2 | `audit-guard.test.ts` |
| AES-GCM + AAD, hashes, PKCE | P2 | `crypto.test.ts` (RFC 7636 vector) |
| OIDC sign-in, state/nonce/PKCE, id_token checks, session rotation, CSRF, return_to | P3 | `oidc-login.test.ts` |
| Discovery (both docs), no hard-coded endpoints | P3 | fake discovery in tests |
| Accounts sync, last4 only, not-allowed default | P4 | `sync.test.ts` |
| 429 handling (headers → body → backoff) | P4 | `api-retry.test.ts` |
| Default strict policy + ceilings | P4 | `policy-schema.test.ts` |
| Public deploy, capability spike (Q3, Q6, Q9, Q11) | P5 | manual + docs ⛔ |
| Single-flight refresh, 401 retry, revoke | P6 | `token-refresh.test.ts` |
| 16 rules, evaluate, 13×17 state machine | P7 | rule/evaluate/state tests, 100% branches |
| Propose/approve/deny/cancel/expire/kill/mode, locks, idempotency, paper ledger, approval page, email, sweeper | P8 | `intents.test.ts`, `approvals.test.ts`, demo script |
| OAuth AS: metadata, CIMD, consent, codes, tokens, rotation, reuse, revoke, audience | P9 | `oauth-server.test.ts` |
| MCP endpoint, 8 tools, annotations, data minimisation, rate limits | P10 | `mcp.test.ts` + Claude manual ⛔ |
| Connected apps revoke (G18) | P9 | `oauth-server.test.ts` |
| Policy editor, kill switch UI, mode gates UI, audit view, deletion, privacy | P11 | `dashboard.test.ts` |
| Webhooks: canonical JSON, signature, dedupe, stale, async, re-sync | P12 | `webhooks.test.ts` + real fixture ⛔ |
| Live: gates, place once, UNKNOWN, tracking, impact preview | P13 | live tests (conditional) ⛔ |
| Secure headers / clickjacking (G12) | P3 | header assertions in `oidc-login.test.ts` |
| Paid always-on hosting before Claude testing (C6) | P10 | checkpoint item |
| Docs, threat model, demo | P14 | checkpoint |

Pass 2: ordering dependencies (each phase only uses what earlier phases built):
- P3 needs P2 (crypto, sessions table). P4 needs P3 (signed-in user, tokens). P6 changes `getAccessToken` used since P4 (same signature, so no callers change).
- P6's disconnect references MCP tables (P2 schema) and the intents service (P8). It is written defensively (no-op if nothing exists) and re-tested in P8/P9.
- P7 is pure and depends on nothing but `lib/money` (P2).
- P8 needs P4 (accounts), P6 (tokens), P7 (engine). P5's spike results must be applied before P8 (⛔).
- P9 needs P3 (sessions/login), with the login route extended for `mcp_request`. P10 needs P8 + P9.
- P11 needs P8–P10 (it edits what they read). P12 needs P4 sync. P13 needs P8 + P12 sweeper patterns.
- No phase installs a dependency before it is needed. Every dependency is in the V§15 table (+ dev tooling: `@types/*`, `@vitest/coverage-v8`, `@modelcontextprotocol/client` for tests).
