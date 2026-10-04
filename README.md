# Guardrail Gateway

**Let an AI assistant propose trades for you, but only inside rules you set, and only after you click Approve.**

> **Try it in 2 minutes, no sign-up:** open the site and press **"Try the demo"**. You get a 24-hour demo account with clearly labelled fake brokerage data and a guided page: ask for an order that is too big (rejected, with the reasons), ask for one that is allowed, approve it, see it filled, and read the audit log. The public URL is added after the first deploy; until then, run it locally (see [Run it locally](#run-it-locally)) and open http://localhost:3000.

Guardrail Gateway is a server-side safety layer between AI assistants (Claude, through the Model Context Protocol, MCP) and the brokerage accounts a person has connected through [SnapTrade](https://snaptrade.com). The AI can read the accounts you allow and **propose** orders. Every proposal is checked by a pure policy engine against your limits, waits for **your explicit approval on this website**, and only then executes, in **paper (simulated) mode** by default. Everything is written to an append-only audit log, and one kill switch stops everything. The AI has no tool that can approve an order, change a limit, or turn the kill switch off.

Not financial advice. Guardrail Gateway never recommends trades.

---

## Contents

- [How it works](#how-it-works)
- [Connect Claude](#connect-claude)
- [The guardrails](#the-guardrails)
- [Architecture](#architecture)
- [Two OAuth relationships](#two-oauth-relationships)
- [Tradeoffs worth explaining](#tradeoffs-worth-explaining)
- [Known limits](#known-limits)
- [Run it locally](#run-it-locally)
- [Tests](#tests)
- [Repository map](#repository-map)
- [Documents](#documents)

## How it works

1. **Sign in with SnapTrade** (OpenID Connect). We store your SnapTrade tokens encrypted (AES-256-GCM) and copy your accounts. **No account is allowed by default:** you choose which ones the AI may see.
2. **Connect Claude** to `https://<host>/mcp`. Claude registers with our own small OAuth server, you approve it on a consent screen that names the requesting app and where it sends you back, and Claude gets a token that works only on our MCP endpoint.
3. **Claude proposes** ("buy 2 VFV.TO in my TFSA"). We resolve the symbol with SnapTrade, fetch a fresh price and your holdings, then, holding a per-user database lock, run all 16 policy rules and record the result:
   - any rule fails → `POLICY_REJECTED`, and Claude gets every reason in plain English;
   - all pass → `PENDING_APPROVAL`, and Claude gets an approval link (also on your dashboard, and optionally emailed).
4. **You approve** on our site (signed in, a POST with a CSRF token; opening the link alone never does anything). We fetch fresh data and **run the whole policy again**, because things may have changed, then execute.
5. **Paper mode** fills the order in our own ledger at the fresh price. Live trading is designed and gated but not built, because SnapTrade hasn't enabled the `trade` scope for this app yet.
6. **Everything is audited** in the same database transaction as the change it records. The audit table can't be edited or deleted (a database trigger enforces it), except by deleting your whole account.

An order moves through a small state machine: `PROPOSED → PENDING_APPROVAL | POLICY_REJECTED`, then `APPROVED → EXECUTING → FILLED | CLOSED` (or `DENIED`, `EXPIRED`, `CANCELLED`). Every transition goes through one pure function, `transition(state, event)`, tested for all 221 state/event pairs.

## Connect Claude

The connector URL is `https://<host>/mcp` (shown on your dashboard).

- **Claude (web or desktop):** Settings → Connectors → Add custom connector → paste the URL → sign in (SnapTrade, or "Try the demo") → Allow.
- **Claude Code:** `claude mcp add --transport http guardrail https://<host>/mcp`, then sign in and Allow in the browser window it opens.

The 8 tools, always in this order: `list_accounts`, `get_positions`, `get_balances`, `get_policy`, `propose_order`, `get_order_status`, `list_recent_intents`, `cancel_order_intent`. There is deliberately no tool to approve, deny, change the policy, allow accounts, use the kill switch, switch mode, or disconnect. Every tool description ends with: *"Orders always require the human to approve them on the Guardrail Gateway website."*

## The guardrails

The policy engine (`src/policy/`) is pure code: no database, no network. It runs every rule (no short-circuit), so the AI and the user see every problem at once.

| Rule | Passes when |
|---|---|
| `kill_switch_off` | The kill switch is off. |
| `connection_healthy` | The brokerage connection isn't broken. |
| `account_allowed` | You allowed the account, and it still exists at SnapTrade. |
| `mode_allowed` | Paper always; live only if every live gate passes (never for demo users). The order keeps the mode it was proposed in, so it can't silently switch from paper to live. |
| `side_allowed` | Buy (default) or sell, if you enabled selling. |
| `no_short_selling` | A sell never exceeds what you hold, minus your other open sells. |
| `asset_type_allowed` | Stocks and ETFs only. |
| `symbol_allowed` | Not on your denylist; on your allowlist if you set one. |
| `order_type_allowed` | Market or limit, Day only. |
| `quantity_valid` | Positive, at most 6 decimals; whole shares only in live mode. |
| `currency_supported` | The security trades in your policy currency (no FX guessing). |
| `price_available` | We have a usable price to estimate the value. |
| `max_order_value` | Estimated value ≤ your per-order limit (default $100). |
| `max_daily_value` | Today's orders (Toronto calendar day) + this one ≤ your daily limit (default $250). Orders waiting for approval count. |
| `max_orders_per_day` | At most 5 orders a day by default. |
| `approval_required` | Always passes; listed so everyone sees approval is mandatory. |

Around the rules:

- **The same `evaluate()` runs at proposal and again at approval**, with fresh data, inside a per-user row lock. Two approvals at the same moment can't both squeeze under the daily limit, and one intent can't execute twice (both proven by concurrency tests).
- **Approvals:** session + POST + CSRF token; another user's intent answers 404; expired intents (10 minutes by default) can't be approved; the approval page follows SnapTrade's *Order Impact and Confirmation* guide (source of every estimate, fees "None (simulated)" in paper mode, the disclaimer, expiry time).
- **Idempotency:** a repeated `idempotency_key` returns the same intent; the same key with different order details is refused.
- **Kill switch:** cancels everything waiting for approval and refuses everything new, in one locked transaction.
- **Rate limits:** 60 MCP tool calls and 10 proposals per user per minute; 30 sign-in/OAuth requests per IP per minute; 5 demo starts per IP per hour.
- **Hard ceilings** on the policy editor: per-order ≤ 10,000, daily ≤ 50,000, ≤ 50 orders a day, approval window 5–30 minutes.

## Architecture

One Node.js 24 process (Hono, TypeScript 7, Drizzle, Postgres), one server-rendered website with no client-side JavaScript.

```
Claude (web / desktop / Claude Code)
      │  MCP over HTTP + a bearer token issued by US
      ▼
┌──────────────────────── Guardrail Gateway (one Node 24 process) ─────────────────────────┐
│  /mcp (SDK v2, stateless) ──► 8 tools ──► intent service ──► policy engine (pure)         │
│    ▲ bearer gate                               │                  state machine (pure)    │
│  our OAuth server (CIMD)                       ▼                                           │
│  /oauth/authorize, /token, /revoke       approval page ──► executor ──► paper ledger      │
│                                                                                            │
│  Web UI: dashboard · approvals · policy · audit · AI apps · kill switch · demo · privacy   │
│  SnapTrade client: sign-in (OIDC + PKCE) · encrypted tokens · single-flight refresh ·     │
│                    API wrapper (timeouts, 429 handling, short caches)                     │
│  Webhooks ──► stored, deduplicated ──► processed later as "re-sync" hints                 │
│  Sweeper (every 60 s): expire intents · retry webhooks · delete 24h-old demos · purge     │
└────────────────────────────────────────────────────────────────────────────────────────────┘
      │                                         │
      ▼                                         ▼
SnapTrade API ──► the user's brokerages      Postgres (Neon)
```

Every request handler is thin: parse input with Zod, call one service function, render or redirect. Every state change is one transaction: lock the user row → check the transition → `UPDATE … WHERE status = $current` → write the audit row. Network calls happen before that transaction, never while holding a lock (the token refresh is the one documented exception).

## Two OAuth relationships

1. **We are an OAuth client of SnapTrade.** We hold the user's SnapTrade tokens, encrypted, and use them to read accounts (and, later, place orders in live mode).
2. **We are an OAuth authorization server for MCP clients.** Claude gets a token **from us**, bound to our `/mcp` URL. Claude never sees a SnapTrade token. If we passed SnapTrade's token through, Claude could call SnapTrade directly and skip every guardrail; keeping our own token boundary is the point of the product.

Our server is small and hand-written: authorization code + PKCE (S256), Client ID Metadata Documents (CIMD) with a host allowlist (`claude.ai`), exact redirect matching (loopback on any port for Claude Code), 60-second single-use codes, opaque tokens stored only as SHA-256 hashes, 1-hour access tokens, 30-day rotating refresh tokens with reuse detection (reuse revokes the whole grant), and RFC 7009 revocation.

## Tradeoffs worth explaining

- **Server-side guardrails, not prompt instructions.** A prompt is a suggestion; a server the AI can't modify is enforcement.
- **Human approval is the defence against prompt injection.** We can't stop a model from being manipulated, but we make manipulation insufficient: the approval page shows our own resolved data, not text the AI wrote.
- **Pure policy engine and state machine.** Deterministic, table-tested (100% branch coverage enforced in CI), and small enough to audit.
- **Row locks, not advisory locks.** Neon's pooled connections (PgBouncer, transaction mode) break session-level locks; `SELECT … FOR UPDATE` inside a transaction is safe.
- **Opaque hashed tokens instead of JWTs.** Revocation is instant (kill an app, disconnect, delete) and there are no signing keys; the cost is one indexed lookup per request.
- **CIMD instead of Dynamic Client Registration.** It follows the 2026-07-28 MCP spec, and the host allowlist removes look-alike clients and server-side request forgery.
- **Webhooks are hints.** We never trust a webhook's payload as state; we re-read the truth from SnapTrade. A replayed or late webhook can only cause a harmless re-read, which also makes SnapTrade's 30-minute retries usable.
- **Never auto-retry an order placement** (live mode design): a timeout may still have placed the order, so the intent goes to `UNKNOWN` and is reconciled.
- **Paper by default, live gates in code:** `LIVE_TRADING_ENABLED=false` and `LIVE_TRADING_PAPER_ACCOUNTS_ONLY=true` make "never test on real money" a configuration check, not a promise.
- **One policy currency, no FX.** Refusing beats guessing with someone's money.
- **An instant demo for reviewers.** Test OAuth apps allow 5 users, and trying it for real needs a SnapTrade account and a Claude connector. The demo runs the same code on labelled fake data, so anyone reaches a filled order in under 2 minutes.

## Known limits

- **Paper only.** The live executor (placing real orders through SnapTrade) is designed (state machine, gates, reconciliation) but not built: SnapTrade hasn't enabled the `trade` scope for this app.
- **Single instance.** Caches and rate limits are in memory. Scaling out would move them to Postgres or Redis.
- **No FX.** Orders in a currency other than your policy currency are refused.
- **No cancelling at the broker.** The kill switch stops everything not yet sent; orders already at a broker must be cancelled there (shown in the UI).
- **SnapTrade response shapes are from the documentation**, not yet checked against real Sandbox responses (that check happens at deploy time; see `DECISIONS.md` D16, D19, D23).
- **Hosting:** Render's free tier sleeps after 15 idle minutes; a 5-minute uptime ping keeps it awake so Claude's 10-second OAuth limits are met.

## Run it locally

Prerequisites: Node.js 24, Docker (for Postgres 17).

```bash
npm ci
cp .env.example .env              # then fill in the values (names only in the example)
npm run db:test:up                # starts Postgres 17 on port 5433 (container gg-db-test)
npm run db:migrate                # applies the migrations to DATABASE_URL
npm run dev                       # http://localhost:3000
```

- `TOKEN_ENCRYPTION_KEY`: 32 random bytes in base64, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **Only want the demo?** The demo never calls SnapTrade, so placeholder SnapTrade values are enough; set `DATABASE_URL` to the Docker database (`postgres://postgres:postgres@localhost:5433/guardrail_test`, which the tests also use and wipe).
- **Real sign-in** needs a SnapTrade OAuth app (client id and secret, with `http://localhost:3000/oauth/snaptrade/callback` registered) and a SnapTrade Personal account with the Sandbox brokerage.
- `npx tsx scripts/demo-flow.ts` runs propose → approve → paper fill in-process against the test database and a fake SnapTrade, and prints the audit trail.

The server refuses to start with a missing or invalid environment variable and names the variable (never its value).

## Tests

```bash
npm run db:test:up
npm run check          # Biome lint + TypeScript typecheck
npm test               # 700+ unit and integration tests
npm run test:coverage  # also enforces 100% branch coverage on the policy engine and state machine
```

Integration tests use a real Postgres and a programmable fake SnapTrade injected as `fetch`; **no test ever calls the real SnapTrade API**. A controllable clock drives expiry and daily limits. Highlights: double approval executes once; two intents over the daily limit approved at once → exactly one fills; 10 concurrent API calls with an expired token refresh exactly once; the full OAuth flow including code reuse and refresh-token reuse; the MCP tools through the real MCP SDK client on both protocol versions; webhook signatures cross-checked against Python; account deletion leaves zero rows in every user table; demo users never reach SnapTrade. GitHub Actions runs `check` and the coverage tests on every push.

## Repository map

```
src/
  app.ts, server.ts, deps.ts     app wiring, startup and graceful shutdown, injected dependencies
  policy/                        pure policy engine: 16 rules, evaluate(), plain-language description
  intents/                       state machine (pure), propose / approve / deny / cancel, expiry, kill switch, mode
  executors/                     executor interface and the paper executor
  approvals/                     approval page and best-effort email
  snaptrade/                     sign-in (OIDC), token vault and refresh, API client, typed calls, caches, sync
  oauth-server/                  our OAuth server for MCP clients (metadata, CIMD, consent, tokens, revoke, verify)
  mcp/                           MCP endpoint and the 8 tools
  webhooks/                      canonical JSON, signature check, receiver, processor
  demo/                          built-in demo brokerage, demo accounts, guided page
  web/                           pages, settings, security headers, rate limits
  db/                            schema, migrations (including the append-only audit trigger)
tests/                           unit + integration tests, fake SnapTrade, test helpers
scripts/demo-flow.ts             the P8 end-to-end flow without any AI
```

## Documents

| File | What it is |
|---|---|
| [`PRODUCT_VISION.md`](PRODUCT_VISION.md) | The full product vision: flows, architecture, rules, state machine, security, data model, verified external facts, open questions |
| [`DECISIONS.md`](DECISIONS.md) | Every non-obvious decision: what, why, alternatives |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Assets, attackers, and the mitigation for each |
| [`API_FEEDBACK.md`](API_FEEDBACK.md) | Rough edges found in SnapTrade's API and docs, with our workarounds |
| [`docs/demo-script.md`](docs/demo-script.md) | Script for the 2–3 minute demo video |
| [`claude/BuildFlow.md`](claude/BuildFlow.md), [`claude/Progress.md`](claude/Progress.md) | The phase-by-phase build plan and its progress |

## Not financial advice

Guardrail Gateway never recommends trades. It only enforces the limits you set and asks for your approval.
