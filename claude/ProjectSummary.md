# Guardrail Gateway — Project Summary

**Let an AI assistant trade for you, but only inside rules you set and only after you click Approve.**

AI assistants like Claude can now connect to brokerage accounts. Read-only connectors are safe but can't act. Broker-built agents only work inside one broker. DIY bots "enforce" limits with sentences in a prompt. Guardrail Gateway is a server-side safety layer between an AI assistant and every brokerage SnapTrade supports. The AI reads the accounts you allowed and **proposes** orders. Every proposal is checked by a pure policy engine (limits, allowed symbols, no short selling, …), waits for **your explicit approval** on our website, and only then executes. Paper (simulated) mode is the default. Everything is audited. One click stops everything.

Built as a SnapTrade internship application project (SnapTrade OAuth app, publicly hosted, defended in a code deep dive).

Full detail: `PRODUCT_VISION.md`. Build order: `claude/BuildFlow.md`.

---

## System Overview

```
Claude (web / desktop / Claude Code)
      │  MCP (Streamable HTTP) + Bearer token issued by US (opaque, audience-bound)
      ▼
┌────────────────────── Guardrail Gateway (one Node 24 process, Hono) ──────────────────────┐
│ /mcp (MCP SDK v2) → tools → intent service → policy engine (pure) → state machine (pure)   │
│ our OAuth server (CIMD, PKCE, rotating refresh)      approval page + email (human decides)  │
│ web UI (server-rendered, no client JS)               executors: Paper (default) │ Live (gated)│
│ SnapTrade OIDC client + encrypted token vault (single-flight refresh)                      │
│ webhook receiver → re-sync hints              audit log (append-only, DB-enforced)         │
│ sweeper (expiry, webhooks, live order tracking)                                             │
└──────────────┬──────────────────────────────────────────────┬─────────────────────────────┘
               ▼                                              ▼
     SnapTrade API → user's brokerages                Postgres (Neon)
```

**Two OAuth relationships:** we are an OAuth *client* of SnapTrade (we hold the user's SnapTrade tokens, encrypted), and an OAuth *authorization server* for Claude (Claude gets our token and never sees SnapTrade's).

**Core principle:** the AI proposes; the user's rules and the user's approval decide. The AI has no tool that can approve, change limits, toggle the kill switch, or switch to live mode.

---

## Core Features (v1)

- Sign in with SnapTrade (OIDC + PKCE + state + nonce); tokens encrypted with AES-256-GCM
- Explicit per-account allow list (nothing allowed by default)
- Policy engine: 16 rules (kill switch, connection health, allowed account, mode gates, sides, no short selling, stocks/ETFs only, symbol allow/deny, market/limit only, quantity validity, single policy currency, price availability, per-order value, daily value, daily order count, approval always required)
- Order intent state machine (13 states, 17 legal transitions, every transition audited in the same DB transaction)
- Human approval page following SnapTrade's Order Impact and Confirmation guide; link alone never approves (session + POST + CSRF)
- Paper executor (default) with a simulated ledger; live executor gated behind server flags, the trade scope, and paper-accounts-only
- MCP server with 8 tools (read accounts, positions, balances, policy; propose, status, list, cancel)
- Our OAuth 2.1 authorization server for MCP clients (CIMD with a host allowlist, PKCE S256, resource-bound opaque tokens, rotating refresh with reuse detection)
- Kill switch, connected-AI-apps revoke, disconnect (real revocation), full account deletion, privacy page
- Signed, deduplicated SnapTrade webhooks treated as "re-sync" hints
- Idempotent proposals, per-user row locks against races, lazy expiry plus sweeper

## Non-goals (v1)

No trade recommendations · no autonomous trading · no options/crypto/funds/margin/short selling · no stop/GTC/extended hours · no FX · no cancel-at-broker · no stored brokerage credentials · not financial advice · no mobile app · single instance.

---

## Tech Stack

| Part | Choice |
|---|---|
| Runtime / language | Node.js 24 LTS, TypeScript (strict, ESM, NodeNext) |
| Web | Hono 4 + @hono/node-server, Hono JSX server-rendered, no client JS |
| MCP | @modelcontextprotocol/server v2 + @modelcontextprotocol/hono |
| DB | Postgres (Neon, pooled) via `pg` + Drizzle ORM + drizzle-kit |
| Validation | Zod 4 |
| OIDC/JWT | jose (SnapTrade id_token only; our tokens are opaque) |
| Money | big.js (never JS floats) |
| Email | Resend HTTP API via fetch (optional) |
| Tests | Vitest; real Postgres in Docker (local) / service container (CI); fake SnapTrade via injected fetch |
| CI | GitHub Actions (typecheck + tests) |
| Hosting | Render web service (Starter, always-on, during review) + Neon, same region |

---

## Category

Web backend with server-rendered UI and an AI-tool (MCP) interface; security-critical OAuth and financial-transaction workflow.
