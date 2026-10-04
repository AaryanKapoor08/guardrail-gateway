# Guardrail Gateway — Progress Tracker

Update this file as you complete each phase (use /progress-save).

**Current Phase: PHASE 14 — The 2-Minute Test: Instant Demo (M10a)** (P13 skipped: trade scope not enabled) (P5 deferred to Aaryan)

Last Updated: 2026-10-04

---

## Session Notes

- 2026-10-03: Planning complete. PRODUCT_VISION.md (final vision, cross-checked twice against live SnapTrade, Claude-connector, and MCP docs) and claude/BuildFlow.md written. Repo created and pushed. .env created locally (git-ignored) with TOKEN_ENCRYPTION_KEY pre-generated. Waiting on Phase 0 human tasks.
- 2026-10-03: Env verified live. Neon OK (Postgres 17.11, pooled, us-east-1, transactions OK through pooler, sslmode switched to verify-full). SnapTrade discovery + JWKS OK. Client id+secret ACCEPTED by the token endpoint (wrong-secret control rejected with invalid_client). Consumer key set (50 chars), but it can only be verified with a real webhook (P12). Redirect URI registration is verified by the first real sign-in (P3). Still TODO at that point: Node 24, Docker.
- 2026-10-03: Node 24.19.0 installed (winget OpenJS.NodeJS.LTS, replaced 22.16). Docker Desktop started (engine 29.5.3). Full re-test under Node 24: Neon + Docker Postgres 17 (transactions + row locks), SnapTrade discovery, client creds, AES-256-GCM key, base-URL/redirect origin: all OK. Coding standards added to CLAUDE.md; stack bumped to TypeScript 7 + Biome. Instant-demo phase (P14) added so anyone can test in < 2 minutes; free hosting (Render free + 5-min ping). SnapTrade Personal has SnapTrade Sandbox (Active, read-only) + a real Wealthsimple connection (read-only; keep it NOT allowed in our app during development; useful for Q6 raw_type in the P5 spike). Remaining Phase 0: SnapTrade Personal test workspace with Sandbox, Render account.
- 2026-10-04 (overnight autonomous build, batch 1): PHASE 1 + PHASE 2 complete and fast-forward merged to main; CI green on both branches and on main. Hono + TypeScript 7.0.2 + Biome 2.5 scaffold, Zod env validation (fails fast, names only), `/health` with DB check, graceful shutdown, GitHub Actions CI. Full V§14.1 schema (17 tables, incl. `users.is_demo` + `(is_demo, created_at)` index) migrated to Neon and the Docker test DB; append-only audit trigger (V§14.3 verbatim); AES-256-GCM field encryption, PKCE, sha256/random tokens, money (big.js), typed errors, Toronto time display, `writeAudit`. 82 tests passing in 8 files. Decisions D13 + D14 in DECISIONS.md. Next: PHASE 3 on branch `feat/p3-…`.
- 2026-10-04 (single-agent build): PHASE 3 complete in code and merged to main (CI green). Sign in with SnapTrade (OIDC + PKCE + state + nonce, discovery with 24h cache, id_token checks with an injected key source), hashed DB sessions with fixation protection, per-session CSRF tokens plus an Origin check against APP_BASE_URL, security headers, home/dashboard/error pages, strict default policy schema. Fake SnapTrade (RS256 keys, token endpoint with rotation and counters, revocation, data API hooks) and test app helpers added. 142 tests. Human checks pending: real browser sign-in, Deny once, check ciphertext in Neon, check dev logs. Decision D15. Next: PHASE 4.
- 2026-10-04 (single-agent build): PHASE 4 complete in code and merged to main (CI green). snaptradeFetch (10s timeout, 2 read retries on 429/5xx/network using SnapTrade reset headers then body hint then jittered backoff, status-only errors and logs), typed /authorizations and /accounts calls with tolerant Zod schemas, sync into connections/accounts (new accounts not allowed, last 4 only, missing accounts present=false), 5-minute sync cache, dashboard accounts table with allow toggles, refresh, broken-connection and reconnect banners, MCP URL box. Migration 0002 (nullable raw_type, number_last4). 167 tests. Decision D16. Next: PHASE 6 (P5 skipped: deploy + real API check is Aaryan's).
- 2026-10-04 (single-agent build): PHASE 6 complete in code and merged to main (CI green). Single-flight refresh under a grant row lock (hash check reuses a token another request refreshed), 5-minute refresh margin, 401 → refresh once → retry once → needs_reauth, invalid_grant clears tokens, POST /disconnect revokes at SnapTrade and cuts off MCP grants. 178 tests. Decision D17. Next: PHASE 7.
- 2026-10-04 (single-agent build): PHASE 7 complete and merged (CI green). Pure policy engine (16 rules, evaluate, describePolicy) and intent state machine; 221-pair table test; 100% branch coverage enforced in CI. 503 tests. Decision D18. Next: PHASE 8 (built on documented SnapTrade shapes; P5 gate waived by Aaryan).
- 2026-10-04 (single-agent build): PHASE 8 complete in code and merged to main (CI green). Propose → approve → paper fill flow: symbol resolution, prefetch outside the lock, per-user lock + dbCounts + evaluate inside it, idempotency, approval page (V§9.2) with CSRF POSTs, paper executor and ledger, kill switch/mode service functions, intent history and cancel, disconnect cancels pending intents, best-effort Resend email, 60s sweeper, scripts/demo-flow.ts. 563 tests. Decision D19. Human checks pending: dev-DB run + browser approval, V§9.2 manual checklist. Next: PHASE 9.
- 2026-10-04 (single-agent build): PHASE 9 complete in code and merged to main (CI green). Hand-written OAuth authorization server for MCP clients: PRM + AS metadata, CIMD with host allowlist and bounded fetch, loopback redirect matching, consent page (requester host, redirect host, loopback warning), single-use 60 s codes, PKCE S256, rotating opaque tokens with reuse detection, RFC 7009 revocation, verifyAccessToken for the MCP gate, per-IP rate limit, Connected AI apps page. 624 tests. Decision D20. Human check pending: curl the deployed AS metadata (after P5). Next: PHASE 10.
- 2026-10-04 (single-agent build): PHASE 10 complete in code and merged to main (CI green). MCP endpoint on SDK v2 (createMcpHandler, JSON responses, stateless, both protocol eras) behind requireBearerAuth with our verifier, Host/Origin checks, the 8 tools with strict inputs, output schemas, annotations, safe error handling, per-user limits (60 calls, 10 proposals a minute). 647 tests. Decision D21. Human checks pending: the Q5 gate with real Claude web/Code, Inspector, revoke-from-dashboard (all need the P5 deploy). Next: PHASE 11.
- 2026-10-04 (single-agent build): PHASE 11 complete in code and merged to main (CI green). Policy editor (validated by the engine's own schema, version bump, before/after audit), kill switch and mode controls with header state, audit log view, account deletion (best-effort revoke, one transaction under the audit trigger), public privacy page. Fixed a sync isolation bug found by the deletion test. 686 tests. Decision D22. Human check pending: browser walk-through of every setting. Next: PHASE 12.
- 2026-10-04 (single-agent build): PHASE 12 complete in code and merged to main (CI green). Python-compatible canonical JSON, signature check, idempotent storage with stale flag, background processing as re-sync hints (no locks during network calls), sweeper retries and 30-day purge, new-account notice. 710 tests (+1 skipped real-fixture test). Decision D23. Human checks pending: webhook URL in the SnapTrade dashboard, capture and verify one real webhook. Next: PHASE 14 (P13 skipped).

---

## Phase Checklist

### PHASE 0 — Accounts, Keys, Machine (human tasks) [in progress]

- [x] `node -v` → `v24.*`
- [x] `docker info` succeeds
- [x] SnapTrade Test OAuth app exists with the localhost redirect URI; client id + secret saved in `.env`
- [x] Consumer key saved in `.env`
- [x] SnapTrade Personal test workspace has the Sandbox brokerage connected
- [x] Neon pooled `DATABASE_URL` saved in `.env`
- [ ] Render account (free) exists and is linked to GitHub; UptimeRobot account (free) created
- Notes:

### PHASE 1 — Project Scaffold (M0, part 1) [complete]

- [x] `npm run check` → 0 lint errors, 0 type errors
- [x] `npm run db:test:up && npm test` → env + health tests pass
- [x] `npm run dev` with real `.env` → `curl localhost:3000/health` returns `{"status":"ok"}` (Neon reachable)
- [x] Starting with `TOKEN_ENCRYPTION_KEY` removed prints a readable error and exits 1
- [x] CI workflow green on GitHub
- [x] Commits: `chore(config): scaffold node 24 hono server with env validation` · `test(config): cover env validation and health check` · `ci: run typecheck and tests on push`
- Notes: Verified 2026-10-04. TS 7.0.2 accepted every tsconfig option unchanged (also set `noEmit: true` in the base config; the build config turns emit on). Biome 2.5: `"preset": "recommended"` (the `recommended: true` key is deprecated) and `noFloatingPromises` / `noMisusedPromises` live in the nursery group, enabled as errors (a probe file confirmed the rule fires). `.env` is loaded with Node's built-in `process.loadEnvFile()` (no dotenv); real env vars win over the file. Server started with the real `.env` (`tsx src/server.ts`, the same entry as `npm run dev`) answered `{"status":"ok"}` from Neon. Blank or removed `TOKEN_ENCRYPTION_KEY` prints `[Config] Invalid environment variables: - TOKEN_ENCRYPTION_KEY: is missing` and exits 1. Graceful SIGTERM/SIGINT shutdown is implemented but not exercised on Windows (no POSIX signals); Render deploys will exercise it. Test container is named `gg-db-test`. CI runs 37179551486 (branch) and 37179607651 (main) green. See D13.

### PHASE 2 — Database Schema + Foundations (M0, part 2) [complete]

- [x] `npm run db:migrate` applies cleanly to Neon, and `MIGRATE_TARGET=test npm run db:migrate` to the test DB
- [x] All V§14.1 tables exist (`\dt` or a Drizzle introspection check)
- [x] Audit guard tests pass (update/delete blocked, deletion path allowed)
- [x] Crypto + money unit tests pass, including the RFC 7636 PKCE vector
- [x] Commits: `feat(db): add full schema and initial migration` · `feat(audit): enforce append-only audit log with trigger` · `feat(crypto): add aes-gcm field encryption and token helpers` · `feat(db): add decimal money helpers`
- Notes: Verified 2026-10-04. Both migrations (`0000_initial_schema`, `0001_audit_guard`) applied to Neon **through the pooler** (no direct URL needed) and to the test DB; a second run applies 0. `\dt` on the test DB, a Neon table listing, and an `information_schema` test all show the 17 tables. Includes `users.is_demo` + index `(is_demo, created_at)` for P14. Extra tests beyond the list: deleting a user empties every table (FK design check), check constraints reject unknown values, the audit-deletion setting is transaction-local. `writeAudit` takes a required `createdAt` (injected clock); the app will set the deletion flag with `set_config('app.deleting_user', $id, true)` (same as `SET LOCAL`, but parameterised). Extra commits: `feat(config): add typed app errors and toronto time display`, `docs: record phase 1 and 2 build decisions`. CI run 37179923323 green. See D14.

### PHASE 3 — Sign in with SnapTrade (M1, part 1) [in progress — human checks pending]

- [x] All OIDC integration tests pass
- [ ] **Manual:** `npm run dev`, then sign in at `http://localhost:3000` with the SnapTrade Personal test user → dashboard shows your email
- [ ] Manual: click Deny on the SnapTrade consent screen → friendly declined page
- [ ] Manual: `SELECT access_token_enc FROM snaptrade_grants` shows `v1:…` ciphertext, not a token
- [ ] Logs contain no tokens or codes (search the dev console output)
- [x] Commits: `feat(policy): add policy schema with strict defaults` · `feat(snaptrade): discover oauth and oidc metadata` · `feat(oidc): sign in with snaptrade using pkce state and nonce` · `feat(auth): add hashed db sessions and csrf protection` · `test(oidc): cover login success and failure paths`
- Notes: Built 2026-10-04 and merged to main (CI run 37181007658 green). 142 tests pass. Automated equivalents of the manual items pass against the fake SnapTrade: tokens stored as `v1:` ciphertext that decrypts to the fake's issued tokens; declined consent page stores nothing; a test captures every log line and asserts no code, state, or token appears. The manual items need Aaryan's real browser sign-in. Extra commits: `refactor(db): share order constants with the policy module`, `docs: record phase 3 sign-in decisions`. TTL cache pulled forward from P4. See D15.

### PHASE 4 — Accounts Sync + Dashboard (M1, part 2) [in progress — human checks pending]

- [ ] Manual: after sign-in, the dashboard lists Sandbox accounts, all **not allowed**
- [ ] Manual: allowing an account persists across reloads
- [x] DB shows only `number_last4`, never full account numbers
- [ ] API path prefix confirmed with a real call (no `/api/v1`), noted in `DECISIONS.md`
- [x] All tests pass
- [x] Commits: `feat(snaptrade): add api client with timeouts and 429 handling` · `feat(sync): sync connections and accounts into db` · `feat(web): list accounts and allow toggles on dashboard`
- Notes: Built 2026-10-04 and merged to main (CI run 37181379708 green). 167 tests pass. Automated equivalents pass against the fake SnapTrade: first sync stores accounts not allowed with last 4 digits only (a test asserts the full number appears nowhere in the rows or the page); allowing persists across reloads; 404 for another user's account; CSRF enforced; 429/5xx retry rules with fake timers. Migration 0002 makes raw_type and number_last4 nullable (name falls back). The real-call base-URL check and the manual browser checks wait for Aaryan (P5). See D16.

### PHASE 5 — Deploy Early + API Capability Spike (M2) [not started]

- [ ] `https://<service>.onrender.com/health` → `ok`
- [ ] Keep-awake monitor (UptimeRobot / cron-job.org) pinging `/health` every 5 minutes, showing **up**
- [ ] Sign-in works end to end on the public URL
- [ ] Spike results recorded for Q3, Q6, Q9, Q11 (including exact symbol format for TSX, e.g. `VFV.TO`)
- [ ] Aaryan informed of results and any fallback chosen
- [ ] Commits: `chore(deploy): configure render start with migrations` · `chore(snaptrade): add capability spike script` · `docs: record snaptrade capability spike results`
- Notes: Skipped in the 2026-10-04 autonomous build by agreement with Aaryan (needs Render, UptimeRobot, and real SnapTrade calls). P8+ were built on the documented response shapes; see D16 and later decisions marked "verify in P5".

### PHASE 6 — Token Lifecycle (M3) [in progress — human checks pending]

- [x] Concurrency test proves exactly one refresh call
- [ ] Manual (local): set `access_expires_at` to the past in the DB, reload the dashboard → data loads (refresh happened); grant updated
- [ ] Manual: Disconnect → reconnect required; per V§19.2 #10, the old refresh token no longer works (verify with a one-off curl to the token endpoint using a copied old token *before* disconnecting, then after; **don't paste tokens into chat or logs**)
- [x] Commits: `feat(tokens): add single-flight refresh with row lock` · `feat(snaptrade): refresh once and retry once on 401` · `feat(auth): disconnect revokes snaptrade token` · `test(tokens): prove one refresh under concurrency`
- Notes: Built 2026-10-04 and merged to main (CI run 37181569904 green). 178 tests. 10 concurrent calls with an expired token hit the fake token endpoint exactly once and the DB holds the rotated refresh token; 401 → refresh → retry; second 401 and invalid_grant both clear the grant and set needs_reauth; network error retried once with the same refresh token; 5xx keeps the grant; disconnect revokes with token_type_hint=refresh_token, deletes the grant, revokes MCP grants/tokens, ends the session. Manual DB-expiry and real revocation checks wait for Aaryan. See D17.

### PHASE 7 — Policy Engine + State Machine (M4, pure code) [complete]

- [x] 221-pair state-machine test passes; exactly 17 valid transitions
- [x] Every rule has pass + fail + boundary tests
- [x] 100% branch coverage on policy + state machine
- [x] No I/O imports in `src/policy/**` or `state-machine.ts` (check: no `db`, `fetch`, or `deps` imports)
- [x] Commits: `feat(policy): add pure rule functions and evaluate` · `feat(intents): add pure order intent state machine` · `test(policy): table-driven tests for every rule and transition`
- Notes: Verified 2026-10-04, merged to main (CI run 37181857162 green, now running coverage). 503 tests. 16 pure rule functions with plain-English pass and fail reasons, evaluate() with no short-circuit and half-up cent rounding, describePolicy(), the 13-state/17-event machine with TERMINAL/COUNTED/OPEN_SELL sets. Coverage: 100% statements, branches, functions, lines on src/policy/** and state-machine.ts, enforced by CI (npm run test:coverage). Grep shows no db, fetch, or deps imports in those files. Extra commit: ci: enforce full branch coverage. See D18.

### PHASE 8 — Intents, Approvals, Paper Executor (M5) [in progress — human checks pending]

- [x] `npx tsx scripts/demo-flow.ts` prints propose → `PENDING_APPROVAL` → `FILLED` with the audit trail
- [x] All concurrency, expiry, kill-switch, idempotency, and approval-page tests pass
- [ ] Manual: propose via the demo script against the dev DB, approve in the browser, see the paper position on the dashboard
- [ ] Approval page shows every V§9.2 element (manual checklist)
- [x] Commits: `feat(snaptrade): add positions balances quotes and symbol search` · `feat(intents): propose orders with idempotency and policy checks` · `feat(approvals): add approval page with csrf post actions` · `feat(paper): simulate fills in paper ledger` · `feat(jobs): add sweeper for expiry and cleanup` · `test(intents): cover races expiry kill switch and idempotency`
- Notes: Built 2026-10-04 and merged to main (CI run 37191422996 green). 563 tests. Demo script output: PENDING_APPROVAL → FILLED at 32.1 with the 7-row audit trail (sign-in, sync, proposed, pending_approval, approved, executing, filled). Double approve → one execution row; two intents over the daily limit approved together → one FILLED, one POLICY_REJECTED; expiry, kill switch, mode change, idempotency (incl. two simultaneous retries), quotes down at approval (page 503, intent still pending, no execution), unknown/ambiguous symbol, disconnect cancelling pending intents. An automated page test checks every V§9.2 text element; the manual browser checklist and the dev-DB run wait for Aaryan (need a real sign-in). Fixed a bug in the inherited WIP: paper limit orders compared against their own limit price, so they always filled; prefetch now returns the fresh market price separately. Extra commit: `docs: record phase 8 intent and approval decisions`. See D19.

### PHASE 9 — Our OAuth Authorization Server for MCP Clients (M6, part 1) [in progress — human checks pending]

- [x] All OAuth server tests pass
- [ ] `curl https://<host>/.well-known/oauth-authorization-server` shows `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported: ["none"]`
- [x] Token endpoint responds in < 200ms locally (no outbound calls)
- [x] Commits: `feat(oauth-server): publish protected resource and as metadata` · `feat(oauth-server): validate cimd clients and redirect uris` · `feat(oauth-server): add consent and code issuance` · `feat(oauth-server): issue rotating opaque tokens with pkce` · `feat(web): list and revoke connected ai apps` · `test(oauth-server): cover pkce cimd rotation and reuse`
- Notes: Built 2026-10-04 and merged to main (CI run 37192218744 green). 624 tests (42 OAuth integration + unit tests for the rate limiter and redirect matching). The metadata test asserts both fields locally; the curl against the deployed host waits for P5 (Aaryan). Token endpoint: 7–10 ms locally over 10 exchanges; a test asserts no outbound fetch. CSP moved to web/csp.ts so the consent page can allow the client's redirect origin in form-action. Extra commit: `docs: record phase 9 oauth server decisions`. See D20.

### PHASE 10 — MCP Server + Tools (M6, part 2) [in progress — human checks pending]

- [x] MCP integration tests pass
- [ ] MCP Inspector (`npx @modelcontextprotocol/inspector`) connects to the deployed URL via OAuth and lists 8 tools
- [ ] **Claude web:** add the custom connector → consent → "list my accounts" works
- [ ] **Claude web:** "buy 1 share of <sandbox symbol> in <account>" → pending + link → approve in browser → ask Claude for status → `FILLED`
- [ ] **Claude Code:** same connect + list flow via loopback redirect
- [ ] Revoking the app on the dashboard → Claude's next call fails and asks to reconnect
- [x] Commits: `feat(mcp): mount sdk v2 handler behind bearer gate` · `feat(mcp): add read-only account and policy tools` · `feat(mcp): add propose status list and cancel tools` · `test(mcp): end-to-end tool flow through mcp client`
- Notes: Built 2026-10-04 and merged to main (CI run 37192773388 green). 647 tests. 23 MCP tests through the real SDK client wired to app.fetch, on both the 2025 (initialize) and 2026-07-28 protocol paths: 401 + resource_metadata without a token, 401 after the app is revoked, 403 for a foreign Host, exactly 8 tools in order with annotations and the approval sentence, propose → approve over HTTP → get_order_status FILLED, policy rejection as a normal result, another user's account not found, extra user_id refused, 11th proposal in a minute refused, reconnect message as a normal result. The ⛔ Q5 gate (real Claude web + Claude Code against the deployed URL, `oauth.client_seen` logs) and the keep-awake check need P5's deploy and Aaryan. Extra commit: `docs: record phase 10 mcp decisions`. See D21.

### PHASE 11 — Dashboard Polish (M7) [in progress — human checks pending]

- [ ] Manual checklist: each setting changes behaviour as expected (try each in the browser + one propose)
- [x] Account deletion test proves zero remaining rows
- [x] Privacy page reachable logged out
- [x] Commits: `feat(web): add policy editor with audit trail` · `feat(web): add kill switch and mode controls` · `feat(web): add audit log view` · `feat(web): add account deletion and privacy page` · `test(web): cover dashboard settings and deletion`
- Notes: Built 2026-10-04 and merged to main (CI run 37193321192 green). 686 tests. Automated equivalents of the manual checklist pass: a lower per-order limit rejects the next proposal; denylist and allowlist; currency change refused with open intents; kill switch on/off round trip with the header bar; live mode disabled with the failing gates (and a forced POST refused); audit log newest first with escaped details; deletion leaves zero rows in every table with a user_id column (found from information_schema), plus codes, tokens, executions, and webhook_events, while another user's rows are untouched; every POST refuses a missing CSRF token; every page except /, /privacy, /login needs a session. The deletion test exposed a sync isolation bug (fixed: `fix(sync): link accounts only to the user's own connection rows`). Extra commit: `docs: record phase 11 dashboard decisions`. See D22. The browser walk-through is Aaryan's.

### PHASE 12 — Webhooks (M8) [in progress — human checks pending]

- [x] Signed fixture accepted; unsigned/tampered → 401; duplicate ignored; stale flagged
- [ ] **Real** SnapTrade Sandbox webhook verifies on the deployed URL
- [x] `CONNECTION_BROKEN` (fixture) blocks proposals for that connection's accounts
- [x] Commits: `feat(webhooks): add python-compatible canonical json` · `feat(webhooks): verify signature and store events idempotently` · `feat(webhooks): process events as resync hints` · `test(webhooks): cover signature dedupe stale and real fixture`
- Notes: Built 2026-10-04 and merged to main (CI run 37193855059 green). 710 tests + 1 skipped (the real-fixture test, which runs once `tests/fixtures/webhook-real.json` and the real consumer key exist). Canonical JSON cross-checked against strings and an HMAC produced by Python 3.13. Signed event (sent pretty-printed, keys reordered) → 200, stored, processed; missing/wrong-key/tampered signature → 401 with nothing stored; duplicate webhookId → one row; stale → flagged and debounced (no extra SnapTrade call); foreign client id → ignored; non-JSON → 400; > 64 KB → 413; CONNECTION_BROKEN then CONNECTION_FIXED blocks then unblocks proposals; NEW_ACCOUNT_AVAILABLE adds the account not allowed with a dashboard notice (migration 0004 `first_seen_at`); ACCOUNT_REMOVED → present=false; holdings update drops the cache; failures retried by the sweeper; 30-day purge. Extra commits: `refactor(oauth-server): share the byte-limited body reader`, `docs: record phase 12 webhook decisions`. See D23. Webhook URL configuration and the real fixture are Aaryan's (after P5).

### PHASE 13 — Live Executor (M9) — ⛔ only if SnapTrade enabled `trade` [not started]

- [ ] All live-executor tests pass (including "place called exactly once")
- [ ] Manual paper-account order reaches `FILLED` (or `CLOSED`) via tracking
- [ ] Gates verified: live impossible on a non-paper account with default env
- [ ] Commits: `feat(live): place orders via snaptrade with client order id` · `feat(live): track submitted orders and reconcile unknown` · `feat(approvals): show brokerage preview in live mode` · `test(live): cover outcomes gates and no-retry rule`
- Notes:

### PHASE 14 — The 2-Minute Test: Instant Demo (M10a) [not started]

- [ ] All demo tests pass (including "no SnapTrade calls for demo users")
- [ ] **Stopwatch test on the deployed URL** by someone who has never seen the app: landing → demo → rejected → approved → filled → audit log in **< 2 minutes**, no typing
- [ ] Claude connects to a demo account (sign-in page → "Try the demo") and proposes an order
- [ ] Commits: `feat(demo): add built-in demo brokerage data` · `feat(demo): add instant demo accounts with 24h cleanup` · `feat(web): add guided try page and manual proposal form` · `test(demo): cover demo isolation guided steps and cleanup`
- Notes:

### PHASE 15 — Submission Polish (M10) [not started]

- [ ] README lets a stranger understand the project without other files
- [ ] V§19.2 manual checklist fully ticked on production
- [ ] CI green on `main`, tag `v1.0.0` pushed
- [ ] Commits: `docs: write readme with architecture and tradeoffs` · `docs: complete decisions api feedback and threat model` · `docs: add demo video script`
- Notes:
