# Guardrail Gateway — Progress Tracker

Update this file as you complete each phase (use /progress-save).

**Current Phase: PHASE 0 — Accounts, Keys, Machine (human tasks)**

Last Updated: 2026-10-03

---

## Session Notes

- 2026-10-03: Planning complete. PRODUCT_VISION.md (final vision, cross-checked twice against live SnapTrade, Claude-connector, and MCP docs) and claude/BuildFlow.md written. Repo created and pushed. .env created locally (git-ignored) with TOKEN_ENCRYPTION_KEY pre-generated. Waiting on Phase 0 human tasks.
- 2026-10-03: Env verified live. Neon OK (Postgres 17.11, pooled, us-east-1, transactions OK through pooler, sslmode switched to verify-full). SnapTrade discovery + JWKS OK. Client id+secret ACCEPTED by the token endpoint (wrong-secret control rejected with invalid_client). Consumer key set (50 chars), but it can only be verified with a real webhook (P12). Redirect URI registration is verified by the first real sign-in (P3). Still TODO at that point: Node 24, Docker.
- 2026-10-03: Node 24.19.0 installed (winget OpenJS.NodeJS.LTS, replaced 22.16). Docker Desktop started (engine 29.5.3). Full re-test under Node 24: Neon + Docker Postgres 17 (transactions + row locks), SnapTrade discovery, client creds, AES-256-GCM key, base-URL/redirect origin: all OK. Coding standards added to CLAUDE.md; stack bumped to TypeScript 7 + Biome. Instant-demo phase (P14) added so anyone can test in < 2 minutes; free hosting (Render free + 5-min ping). SnapTrade Personal has SnapTrade Sandbox (Active, read-only) + a real Wealthsimple connection (read-only; keep it NOT allowed in our app during development; useful for Q6 raw_type in the P5 spike). Remaining Phase 0: SnapTrade Personal test workspace with Sandbox, Render account.

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

### PHASE 1 — Project Scaffold (M0, part 1) [not started]

- [ ] `npm run check` → 0 lint errors, 0 type errors
- [ ] `npm run db:test:up && npm test` → env + health tests pass
- [ ] `npm run dev` with real `.env` → `curl localhost:3000/health` returns `{"status":"ok"}` (Neon reachable)
- [ ] Starting with `TOKEN_ENCRYPTION_KEY` removed prints a readable error and exits 1
- [ ] CI workflow green on GitHub
- [ ] Commits: `chore(config): scaffold node 24 hono server with env validation` · `test(config): cover env validation and health check` · `ci: run typecheck and tests on push`
- Notes:

### PHASE 2 — Database Schema + Foundations (M0, part 2) [not started]

- [ ] `npm run db:migrate` applies cleanly to Neon, and `MIGRATE_TARGET=test npm run db:migrate` to the test DB
- [ ] All V§14.1 tables exist (`\dt` or a Drizzle introspection check)
- [ ] Audit guard tests pass (update/delete blocked, deletion path allowed)
- [ ] Crypto + money unit tests pass, including the RFC 7636 PKCE vector
- [ ] Commits: `feat(db): add full schema and initial migration` · `feat(audit): enforce append-only audit log with trigger` · `feat(crypto): add aes-gcm field encryption and token helpers` · `feat(db): add decimal money helpers`
- Notes:

### PHASE 3 — Sign in with SnapTrade (M1, part 1) [not started]

- [ ] All OIDC integration tests pass
- [ ] **Manual:** `npm run dev`, then sign in at `http://localhost:3000` with the SnapTrade Personal test user → dashboard shows your email
- [ ] Manual: click Deny on the SnapTrade consent screen → friendly declined page
- [ ] Manual: `SELECT access_token_enc FROM snaptrade_grants` shows `v1:…` ciphertext, not a token
- [ ] Logs contain no tokens or codes (search the dev console output)
- [ ] Commits: `feat(policy): add policy schema with strict defaults` · `feat(snaptrade): discover oauth and oidc metadata` · `feat(oidc): sign in with snaptrade using pkce state and nonce` · `feat(auth): add hashed db sessions and csrf protection` · `test(oidc): cover login success and failure paths`
- Notes:

### PHASE 4 — Accounts Sync + Dashboard (M1, part 2) [not started]

- [ ] Manual: after sign-in, the dashboard lists Sandbox accounts, all **not allowed**
- [ ] Manual: allowing an account persists across reloads
- [ ] DB shows only `number_last4`, never full account numbers
- [ ] API path prefix confirmed with a real call (no `/api/v1`), noted in `DECISIONS.md`
- [ ] All tests pass
- [ ] Commits: `feat(snaptrade): add api client with timeouts and 429 handling` · `feat(sync): sync connections and accounts into db` · `feat(web): list accounts and allow toggles on dashboard`
- Notes:

### PHASE 5 — Deploy Early + API Capability Spike (M2) [not started]

- [ ] `https://<service>.onrender.com/health` → `ok`
- [ ] Keep-awake monitor (UptimeRobot / cron-job.org) pinging `/health` every 5 minutes, showing **up**
- [ ] Sign-in works end to end on the public URL
- [ ] Spike results recorded for Q3, Q6, Q9, Q11 (including exact symbol format for TSX, e.g. `VFV.TO`)
- [ ] Aaryan informed of results and any fallback chosen
- [ ] Commits: `chore(deploy): configure render start with migrations` · `chore(snaptrade): add capability spike script` · `docs: record snaptrade capability spike results`
- Notes:

### PHASE 6 — Token Lifecycle (M3) [not started]

- [ ] Concurrency test proves exactly one refresh call
- [ ] Manual (local): set `access_expires_at` to the past in the DB, reload the dashboard → data loads (refresh happened); grant updated
- [ ] Manual: Disconnect → reconnect required; per V§19.2 #10, the old refresh token no longer works (verify with a one-off curl to the token endpoint using a copied old token *before* disconnecting, then after; **don't paste tokens into chat or logs**)
- [ ] Commits: `feat(tokens): add single-flight refresh with row lock` · `feat(snaptrade): refresh once and retry once on 401` · `feat(auth): disconnect revokes snaptrade token` · `test(tokens): prove one refresh under concurrency`
- Notes:

### PHASE 7 — Policy Engine + State Machine (M4, pure code) [not started]

- [ ] 221-pair state-machine test passes; exactly 17 valid transitions
- [ ] Every rule has pass + fail + boundary tests
- [ ] 100% branch coverage on policy + state machine
- [ ] No I/O imports in `src/policy/**` or `state-machine.ts` (check: no `db`, `fetch`, or `deps` imports)
- [ ] Commits: `feat(policy): add pure rule functions and evaluate` · `feat(intents): add pure order intent state machine` · `test(policy): table-driven tests for every rule and transition`
- Notes:

### PHASE 8 — Intents, Approvals, Paper Executor (M5) [not started]

- [ ] `npx tsx scripts/demo-flow.ts` prints propose → `PENDING_APPROVAL` → `FILLED` with the audit trail
- [ ] All concurrency, expiry, kill-switch, idempotency, and approval-page tests pass
- [ ] Manual: propose via the demo script against the dev DB, approve in the browser, see the paper position on the dashboard
- [ ] Approval page shows every V§9.2 element (manual checklist)
- [ ] Commits: `feat(snaptrade): add positions balances quotes and symbol search` · `feat(intents): propose orders with idempotency and policy checks` · `feat(approvals): add approval page with csrf post actions` · `feat(paper): simulate fills in paper ledger` · `feat(jobs): add sweeper for expiry and cleanup` · `test(intents): cover races expiry kill switch and idempotency`
- Notes:

### PHASE 9 — Our OAuth Authorization Server for MCP Clients (M6, part 1) [not started]

- [ ] All OAuth server tests pass
- [ ] `curl https://<host>/.well-known/oauth-authorization-server` shows `client_id_metadata_document_supported: true` and `token_endpoint_auth_methods_supported: ["none"]`
- [ ] Token endpoint responds in < 200ms locally (no outbound calls)
- [ ] Commits: `feat(oauth-server): publish protected resource and as metadata` · `feat(oauth-server): validate cimd clients and redirect uris` · `feat(oauth-server): add consent and code issuance` · `feat(oauth-server): issue rotating opaque tokens with pkce` · `feat(web): list and revoke connected ai apps` · `test(oauth-server): cover pkce cimd rotation and reuse`
- Notes:

### PHASE 10 — MCP Server + Tools (M6, part 2) [not started]

- [ ] MCP integration tests pass
- [ ] MCP Inspector (`npx @modelcontextprotocol/inspector`) connects to the deployed URL via OAuth and lists 8 tools
- [ ] **Claude web:** add the custom connector → consent → "list my accounts" works
- [ ] **Claude web:** "buy 1 share of <sandbox symbol> in <account>" → pending + link → approve in browser → ask Claude for status → `FILLED`
- [ ] **Claude Code:** same connect + list flow via loopback redirect
- [ ] Revoking the app on the dashboard → Claude's next call fails and asks to reconnect
- [ ] Commits: `feat(mcp): mount sdk v2 handler behind bearer gate` · `feat(mcp): add read-only account and policy tools` · `feat(mcp): add propose status list and cancel tools` · `test(mcp): end-to-end tool flow through mcp client`
- Notes:

### PHASE 11 — Dashboard Polish (M7) [not started]

- [ ] Manual checklist: each setting changes behaviour as expected (try each in the browser + one propose)
- [ ] Account deletion test proves zero remaining rows
- [ ] Privacy page reachable logged out
- [ ] Commits: `feat(web): add policy editor with audit trail` · `feat(web): add kill switch and mode controls` · `feat(web): add audit log view` · `feat(web): add account deletion and privacy page` · `test(web): cover dashboard settings and deletion`
- Notes:

### PHASE 12 — Webhooks (M8) [not started]

- [ ] Signed fixture accepted; unsigned/tampered → 401; duplicate ignored; stale flagged
- [ ] **Real** SnapTrade Sandbox webhook verifies on the deployed URL
- [ ] `CONNECTION_BROKEN` (fixture) blocks proposals for that connection's accounts
- [ ] Commits: `feat(webhooks): add python-compatible canonical json` · `feat(webhooks): verify signature and store events idempotently` · `feat(webhooks): process events as resync hints` · `test(webhooks): cover signature dedupe stale and real fixture`
- Notes:

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
