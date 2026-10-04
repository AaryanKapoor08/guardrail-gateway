# Guardrail Gateway: Final Product Vision

> **Status:** Final pre-build vision, written 2026-10-03. This document replaces the original project brief wherever the two disagree.
> **Owner:** Aaryan Kapoor (3rd-year CS, University of New Brunswick).
> **Purpose:** One source of truth for what we are building, why, the hard rules, and the build order. Read it fully before writing code.
> **Working name:** Guardrail Gateway (rename later).

Every SnapTrade, Claude, and MCP fact below was re-checked against the live docs on 2026-10-03 (sources in §24). Where something could not be verified, it is labelled **UNVERIFIED** and listed in §21 (Open questions). Do not treat an unverified item as fact.

---

## 0. What changed from the original brief, and why

The original brief was strong. These are the corrections (things that were wrong or out of date) and the gaps I closed. Each one is explained in more detail where it appears.

### 0.1 Corrections (the brief was wrong or out of date)

| # | Original brief said | Reality (verified 2026-10-03) | What we do now |
|---|---|---|---|
| C1 | Node 20+ | Node 20 reached end of life on 2026-04-30 (no more security fixes). Node 24 is LTS, with security support until 2028-04-30. Node 22 is maintenance-only until 2027-04-30. | **Node 24 LTS.** |
| C1b | `GET /accounts/{id}/positions` | That reference page now returns 404. The current docs list **`GET /accounts/{id}/positions/all`**, which tags every position with `instrument.kind` (`stock`, `etf`, `adr`, `mutualfund`, `crypto`, option kinds, …). Requests using the legacy **`/api/v1` path prefix** get a `Deprecation` header dated 2026-06-12. | Use `/positions/all` with `https://api.snaptrade.com/<path>`, no `/api/v1`. |
| C2 | "Always honor Retry-After" | SnapTrade's 429 responses document `X-RateLimit-Reset` (customer level) and `X-RateLimit-Account-Reset` (account level) headers, plus a body like `"Expected available in 7 seconds."`. `Retry-After` is not documented. There is also a **250 requests/min customer-wide** limit on top of the 10/min per-account limit. | The retry logic reads those headers, then the body, then falls back to exponential backoff with jitter. |
| C3 | Live mode uses check impact, then place the checked order by `tradeId` | SnapTrade's docs say that for most use cases you should validate in your own app and place with **`POST /trade/place`** (Place Equity Order). Impact plus checked order "is usually not the primary workflow". Many brokers have no preview at all. | Live mode places with `POST /trade/place`. Impact is only an optional preview on the approval page. This also removes the 5-minute `tradeId` expiry problem. |
| C4 | Approval page shows "account, symbol, side, qty, type, cost, rules" | SnapTrade's *Order Impact and Confirmation* guide requires more: institution, **time in force**, the **source** of each estimate (brokerage preview, app estimate, or not available), fees shown as **"Not available"** (never `$0.00`) when unknown, and a disclaimer. | The approval page follows that guide exactly (§9). |
| C5 | MCP: "verify the spec version, use SDK helpers" | The current MCP spec is **2026-07-28**. It makes the protocol stateless and **deprecates Dynamic Client Registration (DCR)** in favour of **Client ID Metadata Documents (CIMD)**. Claude's connector docs (which reference the 2025-11-25 spec) support both CIMD and DCR. The TypeScript SDK **v2** is stable, has an official Hono adapter, and serves both protocol eras. SDK v2 **no longer ships authorization-server helpers** (they are frozen in a legacy package). | Use SDK v2 (`@modelcontextprotocol/server` + `@modelcontextprotocol/hono`) for the MCP endpoint and bearer checks. We write a small authorization server ourselves, using **CIMD** with a host allowlist (§11). |
| C6 | Render free tier ("first request can be slow") | Free Render services sleep after 15 minutes idle and take **30 to 60 seconds** to wake. Claude waits only **10 seconds** for OAuth discovery and token endpoints. A sleeping server makes "Add connector" fail. | Use a **paid always-on instance** (Render Starter, about $7/month) while the application is under review. The free tier is fine for early smoke tests only (§15). |
| C7 | Webhooks: reject anything older than 5 minutes | SnapTrade retries failed webhooks with exponential backoff **starting at 30 minutes**, at most 3 times. A strict 5-minute rule would reject every retry. | A webhook is only ever a hint to re-read state from SnapTrade, so a stale or replayed webhook is harmless (§12.4). |
| C8 | `SESSION_SECRET` env var | Our sessions are random IDs stored hashed in Postgres, so nothing needs signing. | Removed. One fewer secret to protect. |
| C9 | "Resend free tier, log in dev" | Resend only delivers to addresses other than your own once you verify a sending domain. | Email is optional. The approval link is also returned to the AI and listed on the dashboard (§9.1). A cheap custom domain is recommended (§15). |
| C10 | Idempotency key "within 24h" | A 24-hour window needs extra cleanup logic and gives no real benefit. | The key is unique per user, permanently. If the same key comes back with different order details, we return an error (§8.4). |

### 0.2 Gaps closed (the brief was silent or inconsistent)

| # | Gap | Resolution |
|---|---|---|
| G1 | Non-goal says "no short selling", but no rule enforced it | New rule `no_short_selling`: a sell cannot exceed held quantity minus pending sells (§8). |
| G2 | Dollar limits did not say which currency (CAD and USD accounts both exist) | One **policy currency** per user (default CAD). Orders for securities in another currency are rejected in v1 because we have no FX source (§8). |
| G3 | No way to know a symbol is a stock or ETF | Resolve every symbol through SnapTrade's account-scoped symbol search, which returns a security type code (`cs` = common stock, `et` = ETF) (§8.2). |
| G4 | State machine had no states for live orders after submission, and no "outcome unknown" state | Added `SUBMITTED`, `UNKNOWN`, `CLOSED`, and the transitions between them (§7). |
| G5 | "Today" was undefined for daily limits | A calendar day in **America/Toronto** (Eastern Time), the trading day for both the TSX and US exchanges (§8.3). |
| G6 | Races: two approvals at the same moment could both pass the daily limit | A per-user row lock around proposal and approval (§10.1). |
| G7 | The kill switch cannot recall orders already sent to the broker | Stated honestly in the UI and README. The switch stops everything not yet sent (§4.6). |
| G8 | Data model was missing sessions, login attempts, MCP auth codes and refresh tokens, connections, and the full accounts list | Full schema in §14. |
| G9 | No guard against accidentally testing live mode on real money | Server flags `LIVE_TRADING_ENABLED=false` and `LIVE_TRADING_PAPER_ACCOUNTS_ONLY=true` (SnapTrade accounts expose `is_paper`) (§10.3). |
| G10 | Retrying a live order after a timeout could place it twice | Never auto-retry an order placement. The outcome goes to `UNKNOWN`, then gets reconciled. We pass the intent ID as SnapTrade's `client_order_id` (§10.3). |
| G11 | Per-account rate limit is 10/min and includes quotes and recent orders, but the AI may call `get_positions` repeatedly | Short-TTL caches, no polling of quotes, webhook-driven invalidation (§12). |
| G12 | Clickjacking: someone could frame the approval page to trick a click | `frame-ancestors 'none'` and `X-Frame-Options: DENY` (§13). |
| G13 | Open redirect via "return to approval page after login" | Only relative paths are accepted (§13). |
| G14 | Webhook signature canonicalisation across Python and JavaScript | SnapTrade's sample signs Python `json.dumps(sort_keys=True, separators=(",",":"))`. Python escapes non-ASCII characters by default and JavaScript does not. We reimplement it exactly and test with a fixture (§12.4). |
| G15 | `localhost` vs `127.0.0.1` cookie mismatch in local OAuth testing | `APP_BASE_URL` and the redirect URI must use the same host (§16). |
| G16 | Neon's pooled connections (PgBouncer) break session-level advisory locks | Use only row locks inside transactions (`SELECT … FOR UPDATE`) (§10.1). |
| G17 | Floating-point money maths | Postgres `numeric` and `big.js` in TypeScript. Never JS floats for money or quantity (§15). |
| G18 | No way for the user to see or revoke which AI apps are connected | "Connected AI apps" panel with a revoke button (§6.6). |
| G19 | Requesting the `trade` scope before SnapTrade enables it makes the authorization request fail | The `trade` scope is controlled by a config flag, off by default (§4.1). |
| G20 | No CI | GitHub Actions runs typecheck and tests on every push (§15). |

---

## 1. Why this project exists

**Goal:** get an internship at SnapTrade, a YC-backed company whose APIs connect apps to brokerage accounts.

**Hiring process:** build a small OAuth app on SnapTrade, host it publicly, and apply through their careers page by selecting the project. If it fits, they run a **deep dive**: a walk through the code, the choices made, and what could be improved.

**What that means for how we build:**
- Aaryan must be able to understand and defend every line. Clarity beats cleverness.
- Every non-obvious choice goes into `DECISIONS.md`: what we chose, why, and the alternatives.
- SnapTrade values a sensible scope, explained tradeoffs, working software, reliability, and customer thinking. **A focused app that works perfectly beats a big app that half works.**
- Aaryan has no finance background, so finance terms are explained in plain words (Glossary, §23).

---

## 2. The product

### 2.1 One paragraph

AI assistants like Claude can now connect to brokerage accounts. Today you choose between three options. Read-only connectors are safe but can't act. Broker-specific trading agents only work inside that one broker. DIY bots have "guardrails" that are just sentences in a tool description, which nothing enforces. **Guardrail Gateway is a server-side safety layer between an AI assistant and every brokerage SnapTrade supports.** The AI can read the accounts the user allows and *propose* trades. Every proposal is checked against rules the user set (limits, allowed symbols, and so on), then waits for **explicit human approval** on our website, and only then executes. Paper (simulated) mode is the default. Everything is logged. One click stops everything.

### 2.2 The core principle

> **The AI proposes. The user's rules and the user's approval decide.**
> The AI can never approve its own orders, change its own limits, turn off the kill switch, or switch to live mode. It has no tool that does any of these.

### 2.3 Positioning

| Option | Can act? | Works across brokers? | Guardrails enforced server-side? |
|---|---|---|---|
| SnapTrade's official MCP server (`mcp.snaptrade.com`) | No, read-only (*per brief, re-verify before submission*) | Yes | n/a |
| Broker-built AI agents (Robinhood, Webull, etc.) | Yes | No, one broker each (*per brief*) | Yes, but only inside that broker |
| DIY trading bots / prompt-only rules | Yes | Varies | **No**, the rules are text the model can ignore |
| **Guardrail Gateway** | **Yes, propose only, then human approves** | **Yes, anything SnapTrade Personal connects** | **Yes, a pure policy engine plus human approval** |

We do **not** compete with SnapTrade's read connector. Our value is the enforced trading path.

---

## 3. Users

**Primary user:** a SnapTrade Personal user (someone who has already connected their brokerage accounts in the SnapTrade dashboard) who wants to use Claude with their portfolio and wants hard limits on what the AI can do.

**Secondary audience (the real one for v1):** SnapTrade engineers reviewing the project. They need to:
1. understand it in 60 seconds (README plus demo video),
2. try it (test OAuth apps are capped at **5 users**, so we keep slots free for reviewers),
3. read code that is obviously correct.

---

## 4. Main flows

### 4.1 Flow A: onboarding ("Sign in with SnapTrade")

1. User visits our site and clicks **Sign in with SnapTrade**.
2. We create a fresh `state`, PKCE `code_verifier` (S256), and `nonce`. We store them server-side in a `login_attempts` row tied to this browser by a short-lived cookie, then redirect to SnapTrade's authorization endpoint, which we discovered from metadata.
   - Scopes: `openid email read webhook`. Add `trade` **only** when config `SNAPTRADE_REQUEST_TRADE_SCOPE=true`. SnapTrade rejects any scope our app is not approved for *before* the consent screen, so requesting `trade` early would break sign-in for everyone.
   - We do **not** request `profile`, because we don't need name or picture. Only request what we use.
3. The SnapTrade consent screen appears. The user approves or denies.
4. **Callback** (`/oauth/snaptrade/callback`):
   - `error=access_denied`: show a friendly "You declined, nothing was stored" page. No token exchange.
   - `state` missing or not matching this browser's login attempt: reject. The attempt is consumed so it can never be reused.
   - Exchange the code: POST to the token endpoint with HTTP Basic `client_id:client_secret`, form-urlencoded body, and `code_verifier` plus `redirect_uri`.
   - Verify the `id_token` with `jose`: RS256 signature against the cached JWKS (refetched on an unknown `kid`), `iss`, `aud` equal to our `client_id`, `exp`, plausible `iat`, and `nonce` equal to the stored nonce.
   - Find or create the user keyed on the `sub` claim. Store `email` only for notifications, and send email only if `email_verified` is `true`. We never link accounts by email.
   - Encrypt and store the access token, refresh token, expiry, and granted scope. **Discard the `id_token`.**
   - Rotate to a brand-new session ID (prevents session fixation) and set the session cookie.
5. **Dashboard:** we sync connections and accounts from SnapTrade. **No account is allowed by default.** The user ticks the accounts the AI may see. A default **strict policy** is created: paper mode, approval always required.
6. The dashboard shows our MCP URL (`https://<host>/mcp`) with copy-paste steps for adding it as a custom connector in Claude.

### 4.2 Flow B: connecting Claude (our OAuth server for MCP clients)

1. The user adds `https://<host>/mcp` in Claude. Claude calls it without a token, gets `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, reads our Protected Resource Metadata, then our Authorization Server Metadata.
2. Claude sees `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`, so it uses **CIMD**: its `client_id` is an HTTPS URL pointing at a JSON document that describes it.
3. Our `/oauth/authorize` validates the request (§11.3). If the user has no session, they sign in with SnapTrade first (Flow A) and come back.
4. **Consent screen:** it names the **host of the `client_id` URL** (e.g. `claude.ai`) as the requester, not the self-asserted `client_name`. It shows the redirect host, warns if the redirect is a loopback address (Claude Code), and states plainly: *"This app can read the accounts you allowed and propose orders. Every order needs your approval here."*
5. On Approve (POST plus CSRF), we redirect back with `code`, `state`, and `iss`. Claude exchanges the code at `/oauth/token` (PKCE, public client) for an access token (1 hour) and, if it asked for `offline_access`, a rotating refresh token.
6. **Claude never sees SnapTrade tokens.** Our tokens only work on our `/mcp` endpoint.

### 4.3 Flow C: the AI proposes a trade

1. In Claude: *"buy 2 shares of VFV in my TFSA"*. Claude calls `list_accounts`, then `propose_order`.
2. We validate input (Zod), resolve the account reference and the symbol, and fetch a fresh quote plus positions **before** taking any lock (§10.1).
3. In one transaction, holding the per-user lock, we create the intent, run the policy engine, and write the audit events.
   - **Any rule fails:** status `POLICY_REJECTED`. The tool returns every failed rule with a plain-English reason. Nothing else happens.
   - **All rules pass:** status `PENDING_APPROVAL`, expiry set (default 10 minutes).
4. After commit: send the notification email (best effort). The tool returns `{ intent_id, status: "PENDING_APPROVAL", approval_url, expires_at, estimate… }` so Claude can show the user a link right away.
5. Claude can call `get_order_status` later.

### 4.4 Flow D: the user approves or denies

1. The user opens the approval page from Claude's link, the email, or the dashboard's "Pending approvals" list. **A session is required.** Without one, they sign in and return (the return path is validated, §13).
2. The page shows the full order per SnapTrade's confirmation guide (§9.2), including **which AI app proposed it and when**.
3. **Approve** and **Deny** are POST forms with a CSRF token. **Opening the link never changes anything.** Email scanners open links automatically, so a link alone must be harmless.
4. On Approve, inside a locked transaction: check that the intent is still `PENDING_APPROVAL` and not expired, re-run the full policy with fresh data (things may have changed), then execute (§10).
5. Expired intents cannot be approved. The page says "Expired. Ask the AI to propose again."

### 4.5 Flow E: execution

- **Paper mode (default, always available):** a simulated fill recorded in our own ledger at the fresh approval-time price. No real order. Details in §10.2.
- **Live mode (only if SnapTrade enables `trade` for our app, and only when the server flags allow it):** place with `POST /trade/place`, then track status. Details in §10.3.

### 4.6 Flow F: kill switch, disconnect, delete

- **Kill switch:** one button. In a single transaction (holding the per-user lock) it sets `kill_switch = true` and cancels every `PENDING_APPROVAL` intent. While it is on, all new proposals are rejected. **Limitation, shown in the UI:** orders already sent to a broker (`SUBMITTED` or `UNKNOWN`) cannot be recalled in v1. The UI lists them and tells the user to cancel them at the broker.
- **Revoke an AI app:** in "Connected AI apps", revoking one MCP grant kills its access and refresh tokens immediately.
- **Disconnect SnapTrade:** revoke the refresh token at SnapTrade's revocation endpoint (`token_type_hint=refresh_token`), revoke all our MCP tokens for the user, delete the stored SnapTrade tokens, and cancel pending intents. History stays, and the user can sign in again later.
- **Delete account:** everything in Disconnect, then delete every row for the user, including the audit log (the only time audit rows are deleted, §14.3). If SnapTrade revocation fails, we still delete locally and tell the user to also remove the app in their SnapTrade dashboard.

---

## 5. Verified external facts (checked 2026-10-03)

> Do not invent API fields. If something is not here, check `https://docs.snaptrade.com/llms.txt` (append `.md` to any docs URL for markdown), or ask.

### 5.1 SnapTrade OAuth

- **Discovery:** `GET https://api.snaptrade.com/.well-known/oauth-authorization-server` lists the authorization, token, **revocation**, and registration endpoints. `/.well-known/openid-configuration` lists the OIDC fields (`jwks_uri`, etc.), and the docs' example of it does **not** show `revocation_endpoint`. We read **both** at startup, cache them for 24 hours, and never hard-code endpoints.
- Issuer `https://api.snaptrade.com`. JWKS `https://api.snaptrade.com/.well-known/jwks.json`. RS256. PKCE `S256` only.
- **Confidential client.** The `client_secret` stays on the backend. It is shown once at creation, can be rotated, and rotation invalidates the old one.
- **Token exchange and refresh:** POST, HTTP Basic auth, `application/x-www-form-urlencoded`.
- **Access token:** 10 hours (`expires_in: 36000`). **Refresh token:** no fixed expiry. It **rotates**: using it invalidates it and returns a new one, which must be stored atomically.
- On a `401` from the API: refresh once, retry once. If that fails, clear the tokens and ask the user to authorize again.
- **Refresh responses never include an `id_token`.**
- The token response also has a top-level `sub` object (`email`, `snaptrade_user_id`). It is **deprecated**, so we read identity only from the verified `id_token`.
- `id_token` claims: `iss`, `sub` (SnapTrade Personal user UUID, stable across apps and the same as `userId` in webhooks), `aud`, `exp`, `iat`, `auth_time`, `nonce`, and with the `email` scope, `email` and `email_verified`. There is **no userinfo endpoint**.
- **Scopes:** `openid`, `profile`, `email`, `read` (**always required**), `trade` (**beta, must be enabled for the app first**), `webhook`. `profile` and `email` require `openid`. Requesting an unapproved scope is rejected before consent. Scopes are granted **per authorization**: adding a scope later requires users to go through the flow again, and refresh does not add scopes.
- **API calls:** `Authorization: Bearer <access_token>` only. **Do not** send `clientId`, `consumerKey`, `userId`, `userSecret`, `timestamp`, or `Signature`, even where the API reference marks them required.
- **Redirect URIs** must match exactly (scheme, host, port, path, trailing slash). Up to 10 per app. Production must be HTTPS. Local testing may use `http://localhost`, `http://127.0.0.1`, or `http://[::1]`.
- One **Test** and one **Production** OAuth app per developer account. **Test apps are limited to 5 users.** A Production app requires KYC approval.
- **Revocation:** POST `token=<refresh_token>&token_type_hint=refresh_token` to the revocation endpoint, same client authentication.
- Never log authorization codes, access, refresh, or ID tokens, or the client secret.

### 5.2 SnapTrade data endpoints we use

| Purpose | Endpoint | Notes |
|---|---|---|
| Connections | `GET /authorizations` | Each connection has `type` (read-only or trade-enabled) and `disabled` / `disabled_date`. |
| Accounts | `GET /accounts` | Fields include `id`, `brokerage_authorization` (connection id), `name`, `number`, `institution_name`, `raw_type` (raw broker string, **not normalised**), `account_category` (`INVESTMENT` / `DEPOSIT` / …, may be null), `status`, `balance`, `is_paper`. |
| Positions | `GET /accounts/{id}/positions/all` | Mixed instrument types, discriminated by `instrument.kind` (`stock`, `etf`, `adr`, `mutualfund`, `crypto`, options, …). Each instrument has `symbol`, `raw_symbol`, `currency`, `exchange`. We show `stock` and `etf` positions and summarise the rest as "other". Exact price/units field names are confirmed in the M2 spike. Account-level rate limited. |
| Balances | `GET /accounts/{id}/balances` | Account-level rate limited. |
| Symbol lookup | `POST /accounts/{id}/symbols` | Up to 20 Universal Symbols supported by that account's broker. Each has a type `code` (`cs` common stock, `et` ETF, `crypto`, `oef`, …) and a currency. |
| Quotes | `GET /accounts/{id}/quotes?symbols=<ids or tickers>&use_ticker=<bool>` | We send the resolved **universal symbol id** (so `use_ticker` stays false). Response fields include `last_trade_price`, `bid_price`, `ask_price`. ≤ 10 symbols. **May be delayed. "Not a substitute for a market data provider. Frequent polling … may result in the disabling of your keys."** Account-level rate limited. |
| Recent orders | `GET /accounts/{id}/recentOrders` | Last 24 hours only, realtime. Defaults to executed only, so set `only_executed=false`. Status values include `PENDING`, `ACCEPTED`, `EXECUTED`, `PARTIAL`, `CANCELED`, `REJECTED`, `EXPIRED`, and more. The response has **no `client_order_id` field**. Account-level rate limited. |

Base URL: the docs show `https://api.snaptrade.com/<path>` for OAuth Bearer calls. The legacy `/api/v1` prefix is deprecated (`Deprecation` header dated 2026-06-12), so **we never use it**. We keep the base in config (`SNAPTRADE_API_BASE_URL`) and **confirm it with the first real call in M1**.

### 5.3 SnapTrade trading (only if `trade` is enabled)

- **Recommended equity path:** validate in our app, then `POST /trade/place` (Place Equity Order). Required fields: `account_id`, `action` (`BUY` / `SELL`), `order_type` (`Market` / `Limit` / `Stop` / `StopLimit`), `time_in_force` (`Day` / `GTC` / `FOK` / `IOC` / `GTD`). Exactly one of `symbol` or `universal_symbol_id`, and the brokerage `symbol` is the recommended identifier. `units` (decimal allowed for fractional shares) or `notional_value` (some brokers only). `price` is required for Limit. Optional **`client_order_id`** (UUID) is forwarded to the broker for idempotency, but **enforcement is broker-specific and SnapTrade does not enforce uniqueness**.
- **Optional preview:** `POST /trade/impact` returns a `Trade` whose id expires after **5 minutes**, usable with `POST /trade/{tradeId}`. Not every broker supports previews.
- **Before submitting,** show the account owner the order details and impact information and get explicit confirmation (§9.2).
- **A successful submission does not mean filled.** Track with recent orders, at least 15 seconds apart per account.
- Soft guidance: at most **1 trade request per second per account**.
- The user's **connection must be trade-enabled**. Granting `trade` to our app does not upgrade a read-only connection.
- **Sandbox brokerage is read-only.** Trading cannot be tested there.

### 5.4 SnapTrade rate limits

- **Customer level:** 250 requests/min across everything. Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- **Account level (Personal users, which includes all OAuth users):** 10 requests/min **per account, shared across** holdings, account details, balances, positions, orders, recent orders, activities, order detail, and **quotes**. Headers: `X-RateLimit-Account-*`.
- A 429 body looks like `{"detail":"Request was throttled. Expected available in 7 seconds.", …}`.
- Guidance: don't poll, use webhooks, poll order status no faster than every 15 seconds per account, use backoff with jitter.

### 5.5 SnapTrade webhooks (OAuth apps)

- Delivered only for users whose grant includes `webhook`, to the listener URL configured for our SnapTrade customer account. Schema `oauth_v1`: `schemaVersion`, `webhookId`, `oauthClientId`, `eventTimestamp`, `userId` (= `sub`), `eventType`, `connectionId`, `brokerageId`, `accountId`, `details`.
- **Signature header:** base64 HMAC-SHA256 of the JSON body, re-serialised with **sorted keys and compact separators**, keyed with our **consumer key**.
- Event types we care about: `CONNECTION_BROKEN`, `CONNECTION_FIXED`, `CONNECTION_DELETED`, `CONNECTION_ADDED`, `CONNECTION_UPDATED`, `NEW_ACCOUNT_AVAILABLE`, `ACCOUNT_REMOVED`, `ACCOUNT_HOLDINGS_UPDATED`. These names come from the general webhook list. The OAuth section only says "supported connection and account events", so **which ones are sent under `oauth_v1` is confirmed in M8**, and unknown types are stored and ignored. Webhooks say **what changed, not the data**, so you fetch afterwards.
- Success means a response of `200`, `201`, `202`, or `204`. Failures are retried with exponential backoff **starting at 30 minutes, at most 3 retries**.
- No IP allowlisting. Custom headers are supported.

### 5.6 Claude custom connectors (Anthropic's connector docs)

- Claude supports **CIMD** and **DCR** by default. It uses CIMD only if our AS metadata has **both** `client_id_metadata_document_supported: true` **and** `"none"` in `token_endpoint_auth_methods_supported`; otherwise it falls back to DCR.
- A **`401`** with `WWW-Authenticate: Bearer resource_metadata="…"` starts sign-in. Claude ignores that header on a `200`.
- The PRM `resource` must **exactly** equal the MCP URL the user enters. Claude uses only the **first** entry of `authorization_servers`.
- **Callback URLs:** hosted Claude (web, desktop, mobile) uses `https://claude.ai/api/mcp/auth_callback`. **Claude Code** uses a loopback redirect on a random port. Match `http://localhost/…` and `http://127.0.0.1/…` **ignoring the port**. Claude Code's CIMD is `https://claude.ai/oauth/claude-code-client-metadata`.
- **PKCE S256** always. Advertise `code_challenge_methods_supported: ["S256"]`.
- Claude appends `offline_access` when our AS metadata lists it, to get a refresh token. It refreshes on `401` and up to 5 minutes before expiry. Refresh tokens for public clients must **rotate**. Use RFC 6749 error codes (`invalid_grant`).
- The token endpoint must accept `application/x-www-form-urlencoded`.
- **Timeouts:** 10 seconds for discovery, registration, and token. 30 seconds for refresh.
- Discovery metadata is cached by Claude for about 5 minutes. Anthropic egress IPs: `160.79.104.0/21`.
- The consent screen must display the redirect URI's hostname.

### 5.7 MCP spec and SDK

- Latest spec **2026-07-28**: stateless (no `initialize` handshake, no `Mcp-Session-Id`), adds `server/discover`, **deprecates DCR in favour of CIMD**, and authorization servers **SHOULD** return `iss` in the authorization response (RFC 9207).
- **TypeScript SDK v2** (`@modelcontextprotocol/server` 2.x, Zod 4): `createMcpHandler(factory)` builds a fresh server per request and **serves 2025-era clients from the same factory by default**. `@modelcontextprotocol/hono` provides `createMcpHonoApp` (JSON body parsing plus Host/Origin checks against DNS rebinding). `requireBearerAuth` (web-standard) returns `401` / `403` with the right `WWW-Authenticate` and enforces `expectedResource` (token audience). **Authorization-server helpers are not in v2**, and the docs recommend a dedicated AS.
- Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.

---

## 6. Architecture

### 6.1 Shape

One Node.js service. Simple to deploy, simple to explain.

```
Claude (web / desktop / Claude Code)
      │  MCP over Streamable HTTP + Bearer token issued by US
      ▼
┌──────────────────────────── Guardrail Gateway (one Node 24 process) ────────────────────────────┐
│                                                                                                  │
│  /mcp  (SDK v2 handler) ──► tools ──► Intent service ──► Policy engine (pure) ──► State machine   │
│    ▲ requireBearerAuth                     │                                       (pure)        │
│    │                                       ▼                                                     │
│  Our OAuth AS (CIMD)                 Approval service ──► Executor interface                     │
│  /oauth/authorize,/token,/revoke     (page + email)        ├─ PaperExecutor                      │
│    │                                                       └─ SnapTradeExecutor (live, gated)    │
│  Web UI (Hono JSX, no client JS)                                                                 │
│    dashboard · approvals · policy · audit · connected apps · privacy                             │
│                                                                                                  │
│  SnapTrade client: OIDC login · token vault (AES-256-GCM, single-flight refresh)                 │
│                    API wrapper (timeouts, 429 handling, caches)                                  │
│  Webhook receiver ──► webhook_events table ──► async processor (re-sync from API)                │
│  Audit writer (same transaction as every state change)                                          │
│  Background sweeper (every 60s): expire intents · process webhooks · track live orders          │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
      │                                   │
      ▼                                   ▼
SnapTrade API ──► user's brokerages    Postgres (Neon)
```

### 6.2 Two OAuth relationships (explain this one carefully in the deep dive)

1. **We are an OAuth *client* of SnapTrade.** We hold the user's SnapTrade tokens, encrypted, and use them to read data and, in live mode, place orders.
2. **We are an OAuth *authorization server* for MCP clients.** Claude gets a token **from us**, scoped to our MCP tools and bound (audience) to our `/mcp` URL. Claude never sees SnapTrade tokens.
3. **They connect through sign-in.** When Claude starts authorization, our `/oauth/authorize` requires a logged-in session, and that session came from SnapTrade OIDC sign-in. The MCP grant is then linked to that user.

**Why not just pass SnapTrade's token through to Claude?** Then Claude could call SnapTrade directly and skip every guardrail. Keeping our own token boundary is the whole point of the product.

### 6.3 Why opaque tokens (not JWTs) for our MCP tokens

Our tokens are 256-bit random strings. We store only their SHA-256 hash and look them up on each request.
- **Instant revocation** (kill an AI app, disconnect, delete) with no deny-list.
- Nothing to sign, so there are no signing keys to manage or rotate.
- Cost: one indexed DB lookup per MCP request, which is trivial at our scale.

SHA-256 (not bcrypt) is correct here because the tokens are high-entropy random values, not human passwords.

### 6.4 Why the policy engine and state machine are pure functions

`evaluate(policy, order, context)` and `transition(state, event)` do no I/O. All data is fetched first and passed in. As a result every rule and every transition can be unit-tested with tables, behaviour is deterministic, and the code that decides what is allowed is small and easy to audit.

### 6.5 Executor interface

```ts
interface Executor {
  // Paper: runs inside the approval transaction (pure DB writes).
  // Live: runs AFTER the EXECUTING state is committed, outside any transaction.
  execute(intent: ApprovedIntent, ctx: ExecutionContext): Promise<ExecutionResult>;
}
```

`PaperExecutor` and `SnapTradeExecutor` both implement it. The **mode is captured on the intent at proposal time**. If the user switches mode before approving, the approval re-check fails with "Mode changed since this order was proposed. Ask the AI to propose again." An order can never silently change from paper to live.

### 6.6 Dashboard sections

Accounts (allow / disallow) · Policy editor · Pending approvals · Intent history · Audit log · Connected AI apps (revoke) · Kill switch · Mode (paper/live, live disabled unless every gate passes, §10.3) · Disconnect · Delete account · Privacy · "Not financial advice" notice on every page.

---

## 7. Order intent state machine

### 7.1 States

| State | Terminal? | Meaning |
|---|---|---|
| `PROPOSED` | no | Created, not yet evaluated. Exists only inside the creating transaction (kept for audit clarity). |
| `POLICY_REJECTED` | **yes** | A rule failed, at proposal or at the approval re-check. |
| `PENDING_APPROVAL` | no | Waiting for the human. |
| `DENIED` | **yes** | The user said no. |
| `EXPIRED` | **yes** | The approval window passed. |
| `CANCELLED` | **yes** | Kill switch, user cancel, AI `cancel_order_intent`, disconnect, or account deletion. |
| `APPROVED` | no | The user clicked Approve. Exists only inside the approval transaction. |
| `EXECUTING` | no | Handed to the executor. For live mode, committed **before** calling the broker. |
| `SUBMITTED` | no | Live only: the broker accepted the order. Not filled yet. |
| `UNKNOWN` | no | Live only: we could not tell whether the broker received the order (timeout, network error, 5xx). **Never auto-retried.** |
| `FILLED` | **yes** | Paper: simulated fill. Live: broker reports fully executed. |
| `CLOSED` | **yes** | The order ended without a full fill: broker cancelled, rejected after acceptance, expired at end of day, or a paper limit order that was not marketable. `filled_quantity` records any partial fill. |
| `FAILED` | **yes** | Execution definitively failed: the broker rejected the submission, or the user confirmed an `UNKNOWN` order was never placed. Has a reason. |

### 7.2 Transitions (the only legal ones)

```
PROPOSED          --POLICY_PASSED-->       PENDING_APPROVAL
PROPOSED          --POLICY_FAILED-->       POLICY_REJECTED
PENDING_APPROVAL  --USER_APPROVED-->       APPROVED
PENDING_APPROVAL  --USER_DENIED-->         DENIED
PENDING_APPROVAL  --EXPIRE-->              EXPIRED
PENDING_APPROVAL  --CANCEL-->              CANCELLED
APPROVED          --RECHECK_FAILED-->      POLICY_REJECTED
APPROVED          --RECHECK_PASSED-->      EXECUTING
EXECUTING         --PAPER_FILLED-->        FILLED
EXECUTING         --PAPER_NOT_MARKETABLE-> CLOSED
EXECUTING         --BROKER_ACCEPTED-->     SUBMITTED
EXECUTING         --BROKER_REJECTED-->     FAILED
EXECUTING         --OUTCOME_UNKNOWN-->     UNKNOWN
UNKNOWN           --RECONCILED_FOUND-->    SUBMITTED
UNKNOWN           --USER_CONFIRMED_NOT_PLACED--> FAILED
SUBMITTED         --BROKER_FILLED-->       FILLED
SUBMITTED         --BROKER_CLOSED-->       CLOSED
```

### 7.3 Rules

- **One place enforces transitions:** `transition(current, event) → next | TransitionError`. It is a pure function, **unit-tested for every (state, event) pair**, valid and invalid (13 states × 17 events = 221 cases, table-driven; exactly 17 are valid, matching §7.2).
- **Why there is no `APPROVED → CANCELLED`:** approval runs `PENDING_APPROVAL → APPROVED → EXECUTING` inside one transaction holding the per-user lock, and the kill switch takes the same lock. So `APPROVED` is never visible to anyone else, and a kill switch either runs fully before the approval (the re-check then fails on `kill_switch_off`) or fully after it (the order is already `EXECUTING`/`FILLED`). Every transition in the table is actually reachable.
- **Every transition writes an audit event in the same DB transaction** as the status change. If one fails, both roll back.
- **Optimistic guard in SQL:** `UPDATE order_intents SET status=$next … WHERE id=$id AND status=$current` must affect exactly one row, and the update runs while holding the row lock (§10.1).
- **Expiry is lazy plus a sweeper.** Any read or approval of an intent first expires it if `now() > expires_at`, and a 60-second in-process sweeper expires the rest. Both are idempotent, so correctness never depends on the sweeper running.
- **Crash safety for live orders:** on startup and in the sweeper, any `EXECUTING` intent older than 2 minutes in live mode moves to `UNKNOWN` and is reconciled. Paper mode can never leave `EXECUTING` behind, because it runs in one transaction.

---

## 8. Policy engine (v1)

### 8.1 Signature

```ts
evaluate(policy: Policy, order: OrderRequest, ctx: PolicyContext): { pass: boolean; results: RuleResult[] }
// RuleResult = { rule: RuleId; passed: boolean; reason: string }   // reason is plain English
```

All rules are evaluated, with no short-circuit, so the AI and the user see **every** problem at once. Reasons go back to the AI, onto the approval page, and into the audit log. Example: *"Order value $340.00 CAD exceeds your per-order limit of $100.00 CAD."*

### 8.2 Rules and defaults

| # | Rule id | Default | Passes when |
|---|---|---|---|
| 1 | `kill_switch_off` | off | The kill switch is off. |
| 2 | `connection_healthy` | n/a | The account's connection is not disabled (from our last sync; see §12.3 for freshness). |
| 3 | `account_allowed` | none allowed | The account is explicitly allowed by the user and still exists at SnapTrade. |
| 4 | `mode_allowed` | paper | Paper always passes. Live requires every gate in §10.3. The intent's mode must equal the user's current mode (checked at approval). |
| 5 | `side_allowed` | buy only | The side is in the allowed sides (user can enable sell). |
| 6 | `no_short_selling` | always on | For sells: quantity ≤ held quantity − quantity in other **open** sell intents for that symbol and account. *Open* = `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `SUBMITTED`, `UNKNOWN` (filled sells already show in positions, so they're excluded to avoid subtracting twice). In paper mode, held quantity = real position + paper ledger position. |
| 7 | `asset_type_allowed` | stocks + ETFs | The resolved security type code is `cs` or `et`. Options, crypto, funds, warrants, etc. are rejected. |
| 8 | `symbol_allowed` | allowlist empty (= all allowed), denylist empty | Not on the denylist, and on the allowlist if the allowlist is non-empty. |
| 9 | `order_type_allowed` | market, limit | `Market` or `Limit`. Limit requires `limit_price > 0`. Time in force is always `Day` in v1. |
| 10 | `quantity_valid` | n/a | Quantity > 0, at most 6 decimal places. **Fractional quantities only in paper mode**; live is whole shares only in v1 (broker support varies). |
| 11 | `currency_supported` | policy currency CAD | The security's trading currency equals the user's policy currency. We have no FX rate source, so we refuse rather than guess. |
| 12 | `price_available` | n/a | A usable price exists to estimate value (§8.3). |
| 13 | `max_order_value` | 100 (policy currency) | Estimated value ≤ limit. |
| 14 | `max_daily_value` | 250 | Today's counted value + this order ≤ limit. |
| 15 | `max_orders_per_day` | 5 | Today's counted orders + 1 ≤ limit. |
| 16 | `approval_required` | always, cannot be turned off in v1 | Always passes. Listed so the AI and user see that approval is mandatory. |

**Hard ceilings in v1** (Zod bounds on the policy editor, so a typo can't become a disaster): per-order ≤ 10,000; daily ≤ 50,000; orders/day ≤ 50; approval window 5 to 30 minutes (default 10).

### 8.3 Definitions the rules depend on

- **Symbol resolution:** call `POST /accounts/{id}/symbols` with the AI-supplied ticker. Accept **exactly one exact ticker match** from that broker's results. With zero matches the result is *"Unknown symbol for this account"*. With several, it is *"Ambiguous symbol"* plus the candidates (e.g. `VFV.TO`), so the AI can retry precisely. The resolved symbol, universal symbol id, type code, currency, and exchange are stored on the intent.
- **Estimated price:**
  - Limit order: the **limit price** (the most you'll pay or the least you'll accept).
  - Market order: the latest SnapTrade quote. Use ask for buys and bid for sells when present, otherwise last trade. Labelled *"latest available, may be delayed"*.
  - If quotes are unavailable to OAuth apps (open question Q3), fall back to the position's price for held symbols, labelled *"price from last account sync at …"*. Otherwise `price_available` fails.
- **Estimated value** = quantity × estimated price, computed with `big.js`, rounded to cents (half-up). It applies to **both buys and sells**, so limits also cap panic-selling.
- **"Today"** = the current calendar day in **America/Toronto**. Computed in SQL: `(created_at AT TIME ZONE 'America/Toronto')::date = ($now::timestamptz AT TIME ZONE 'America/Toronto')::date`. `$now` comes from the app's injected clock, never SQL `now()`, so tests control time (the same applies to every expiry comparison).
- **What counts toward daily limits:** every intent created today that was, or still might be, sent to a broker: `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `SUBMITTED`, `UNKNOWN`, `FILLED`, `CLOSED`. Not counted: `POLICY_REJECTED`, `DENIED`, `EXPIRED`, `CANCELLED`, `FAILED`. Pending intents **reserve** budget, so the AI can't queue 20 small orders that each pass alone. The intent being evaluated is excluded from its own count.
- **Currency of the daily value total:** only today's counted intents in the **current** policy currency are summed (all intents have that currency, because `currency_supported` enforces it). The policy currency can only be changed when the user has **no open intents**. Documented edge case: switching currency mid-day starts a fresh value budget in the new currency, while `max_orders_per_day` still counts every order.
- **Proposal vs. approval:** the same `evaluate()` runs both times, with fresh context at approval.

### 8.4 Idempotency

- `propose_order` accepts an optional `idempotency_key` (UUID). The tool description asks the AI to always send one and reuse it on retries.
- There is a unique index on `(user_id, idempotency_key)`. The same key with the **same** order fingerprint (account, symbol, side, quantity, type, limit price) returns the **existing** intent. The same key with a **different** fingerprint returns an error: *"This idempotency key was already used for a different order."* (Stripe uses the same pattern.)
- Without a key, duplicates are still caught by the human. The approval page also warns *"You have another pending order with identical details"*.

### 8.5 What the AI can and cannot do with policy

The AI can read the policy (`get_policy`) in plain language so it proposes valid orders. **Nothing else.** Policy changes happen only in the web UI with a logged-in session plus CSRF, and every change is audit-logged with the before and after values and a version bump. Intents store the `policy_version` they were evaluated against.

---

## 9. Approvals

### 9.1 Three ways to reach the approval page (any one is enough)

1. The `approval_url` returned in the `propose_order` tool result, so Claude shows it immediately.
2. The **Pending approvals** list on the dashboard.
3. An email (optional, best effort, only if `email_verified` and email is configured).

The page is the same in all three cases, and the link never acts on its own.

**Why not email-only?** Delivery is not guaranteed (spam filters, Resend domain verification, free-tier limits), and a 10-minute window makes email delays fatal. The dashboard is the source of truth.

**Phishing note:** a manipulated AI could show a fake link. That is why the user should check the domain, and why the email and dashboard exist as independent channels. The consent and approval pages show our domain prominently.

### 9.2 Approval page content (follows SnapTrade's *Order Impact and Confirmation* guide)

- Big **PAPER** or **LIVE** badge (live in red).
- Banner: *"This order was proposed by an AI assistant. Check every detail. Approving is your decision."*
- **Proposed by:** the AI client host (e.g. `claude.ai`) and the time.
- Institution and account (name, `raw_type`, number masked to the last 4 digits).
- Security: symbol, name, exchange, type (Stock / ETF), currency.
- Action (Buy/Sell), quantity, order type, limit price (if any), **time in force: Day**.
- Estimated price, its **source label** (*Application-generated estimate*, *Brokerage preview*, or *Not available*), and its as-of time.
- Estimated value. **Fees/commissions:** *"Not available"* in live mode unless a brokerage preview supplied them, never `$0.00`. *"None (simulated)"* in paper mode.
- SnapTrade's recommended disclaimer text for estimates or unavailable impact.
- Policy check results (every rule, pass/fail).
- Duplicate warning if an identical intent is pending.
- Expiry time, shown as a clock time (no JavaScript needed).
- **Approve** and **Deny** buttons, both POST + CSRF.
- In live mode, if the broker supports previews, the page calls `POST /trade/impact` on load and shows the result labelled **Brokerage preview**. The preview is **informational only**: we still place with `POST /trade/place` using the exact approved fields, so the preview's 5-minute expiry can never block or alter execution.
- Footer: *"Not financial advice. Guardrail Gateway never recommends trades."*

### 9.3 Email content

Subject: *"Approval needed: BUY 2 VFV.TO (paper)"*. Body: the one-line summary, the expiry time, and a link to the approval page. No account numbers, no tokens, no Approve button. Sending happens **after** the intent commits. A send failure is logged and never fails the proposal.

---

## 10. Execution

### 10.1 Locking and transactions (prevents double spends and double executions)

- **Fetch outside the lock, decide inside it.** Network calls (quotes, positions, symbol search) happen first. Then one transaction:
  1. `SELECT … FROM users WHERE id=$1 FOR UPDATE`, a **per-user lock** that serialises every proposal, approval, denial, cancel, kill-switch toggle, mode switch, and policy change for that user.
  2. `SELECT … FROM order_intents WHERE id=$2 FOR UPDATE` (on approval).
  3. Recompute today's counted totals from the DB, run `evaluate()`, apply `transition()`, write audit rows, commit.
- Two approval clicks, two browser tabs, or two server workers therefore can never both execute one intent, and two different approvals can never both squeeze under the daily limit.
- **Row locks only, never session-level advisory locks.** Neon's pooled endpoint uses PgBouncer in transaction mode, where session-level locks silently break. Row locks inside a transaction are safe there.

### 10.2 Paper executor (default)

- Runs **inside** the approval transaction: `APPROVED → EXECUTING → FILLED/CLOSED` commits atomically.
- **Fill price:** the fresh approval-time price (§8.3).
  - Market orders fill at that price.
  - Limit buy fills at the fresh price **if it is ≤ the limit**, limit sell **if ≥ the limit**. Otherwise `CLOSED` (*"not marketable at approval time; paper mode doesn't simulate resting orders"*).
- **Ledger:** `paper_positions(user, account, symbol)` holds quantity and average cost, and `executions` records each fill. Paper cash is tracked as a running "cash change" per currency. **No buying-power check in v1** (documented). The limits are the guardrail.
- The dashboard shows paper positions clearly separated from real ones.

### 10.3 Live executor (milestone M9, only if SnapTrade enables `trade` for our app)

**Gates.** All must be true, both for the mode toggle to be enabled and at approval time:
1. Server env `LIVE_TRADING_ENABLED=true` (default **false**).
2. The user's grant includes the `trade` scope.
3. The account's connection is trade-enabled and not disabled.
4. If `LIVE_TRADING_PAPER_ACCOUNTS_ONLY=true` (default **true**), the account has `is_paper = true`. **This is how "never test on real money" is enforced in code, not just promised.**
5. The user explicitly switched to live mode in the UI (POST + CSRF, audit-logged).

**Steps.**
1. Commit `EXECUTING` (so a crash can never lead to a blind retry).
2. `POST /trade/place` with `account_id`, `action`, `symbol` (exact broker symbol from resolution), `order_type`, `time_in_force: "Day"`, `units`, `price` (limit only), and **`client_order_id` = the intent's UUID**. Timeout 15 seconds. **Never retried automatically.**
3. Outcome:
   - 2xx: `SUBMITTED`, storing `brokerage_order_id` from the response.
   - Clear 4xx rejection: `FAILED`, with SnapTrade's error message saved, sanitised.
   - Timeout, network error, or 5xx: `UNKNOWN`.
4. **Tracking:** the sweeper polls `GET /accounts/{id}/recentOrders?only_executed=false` no faster than every **15 seconds per account** while any order there is `SUBMITTED` or `UNKNOWN`. It matches on `brokerage_order_id` and maps the status: `EXECUTED` → `FILLED`; `CANCELED`, `PARTIAL_CANCELED`, `REJECTED`, `EXPIRED` → `CLOSED`; `PARTIAL` stays `SUBMITTED` (records the partial); **any other status** (`PENDING`, `ACCEPTED`, `QUEUED`, `TRIGGERED`, …) stays `SUBMITTED`. `get_order_status` also triggers a check, but respects the cache. Polling slows to every 5 minutes after 30 minutes and stops at end of day (Day orders expire).
5. **Reconciling `UNKNOWN`:** the recent-orders response has no `client_order_id`, so we match on account, symbol, side, quantity, and a time window. If exactly one match is found: `SUBMITTED`. Otherwise it stays `UNKNOWN`, and the UI asks the user to check the broker and click *"It was not placed"* (`FAILED`, actor = user). Being honest about the unknown beats guessing.

**At most one live order per second per account** (SnapTrade guidance). Our approval flow is far below that anyway.

---

## 11. MCP surface

### 11.1 Endpoint

- `POST /mcp`, using SDK v2 `createMcpHandler(factory)` with **`responseMode: "json"`** (no streaming needed, which is simpler and proxy-friendly) and **stateless** operation (the factory builds the server per request with the caller's `authInfo`).
- Host/Origin validation (DNS-rebinding protection) is set to our public host.
- **Bearer gate:** SDK `requireBearerAuth` with our `verifyAccessToken`, which hashes the token, looks it up (`kind='access'`), checks the token's `revoked_at` and `expires_at`, that its grant is not revoked, and that the user still exists. It always populates `expiresAt` (the SDK rejects tokens without it), and reports `resource`. `expectedResource = <APP_BASE_URL>/mcp`. Missing or invalid tokens get `401` with `resource_metadata`.
- **Per-user rate limit:** 60 tool calls/min overall, 10 `propose_order`/min (in-memory sliding window, valid because we run one instance; documented). Over the limit, the tool returns a clear error.

### 11.2 Tools

Every tool has a Zod input schema, an output schema with `structuredContent`, and annotations. Tools are listed in a fixed order. Every description ends with: *"Orders always require the human to approve them on the Guardrail Gateway website. This tool cannot approve, change limits, or switch to live trading."*

| Tool | readOnly | destructive | idempotent | Input | Returns |
|---|---|---|---|---|---|
| `list_accounts` | ✅ | ❌ | ✅ | none | Allowed accounts only: `account_ref`, institution, name, `raw_type`, category, last-4 number, paper/real, connection status |
| `get_positions` | ✅ | ❌ | ✅ | `account_ref` | Symbol, quantity, price, value, currency (+ paper positions if paper mode, labelled) |
| `get_balances` | ✅ | ❌ | ✅ | `account_ref` | Cash per currency (+ buying power if SnapTrade provides it) |
| `get_policy` | ✅ | ❌ | ✅ | none | Current rules in plain language + mode + kill-switch state + today's remaining budget |
| `propose_order` | ❌ | ❌ | ❌ | `account_ref`, `symbol`, `side` (buy/sell), `quantity`, `order_type` (market/limit), `limit_price?`, `idempotency_key?` | `intent_id`, `status`, `approval_url` (if pending), `expires_at`, estimate + price source, every check result |
| `get_order_status` | ✅ | ❌ | ✅ | `intent_id` | Status, reasons if rejected, fill details if any |
| `list_recent_intents` | ✅ | ❌ | ✅ | `limit` (1–20, default 10) | Short list: id, created, symbol, side, qty, status |
| `cancel_order_intent` | ❌ | ❌ | ✅ | `intent_id` | `PENDING_APPROVAL` becomes `CANCELLED`. Already `CANCELLED` returns that status unchanged (idempotent). Any other status returns "cannot cancel an order in state X". **Cannot approve.** |

**Deliberately not exposed:** approve, deny, change policy, allow accounts, toggle the kill switch, switch mode, disconnect.

**Data minimisation:** `account_ref` is our own short public ID (not SnapTrade's UUID). Account numbers appear only as the last 4 digits. No tokens, no internal row IDs beyond `intent_id`. Responses are kept small.

**Business outcomes are not errors.** A `POLICY_REJECTED` result is a normal tool result, so the AI can explain the reasons. Only invalid input or system failures return `isError: true`.

**Auth failures mid-session:** if the user's SnapTrade grant needs re-authorization, tools return *"Your SnapTrade connection needs to be renewed. Sign in at <APP_BASE_URL>."* They don't return a 401, because the MCP token itself is still fine.

### 11.3 Our authorization server (hand-written, small, fully tested)

**Why hand-write it?** SDK v2 removed its AS helpers. A full provider such as `oidc-provider` is powerful but large and hard to explain line by line. We need only a narrow subset: authorization code + PKCE + refresh rotation + CIMD + revocation. That is roughly 300–400 lines, and every one of them can be defended.

**Metadata:**
- `GET /.well-known/oauth-protected-resource/mcp` (and `/.well-known/oauth-protected-resource`): `{ resource: "<base>/mcp", authorization_servers: ["<base>"], scopes_supported: ["mcp"], bearer_methods_supported: ["header"] }`
- `GET /.well-known/oauth-authorization-server`: `issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `scopes_supported: ["mcp","offline_access"]`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`.

**`GET /oauth/authorize`:**
1. `client_id` must be an `https://` URL with a path, and its host must be in `MCP_ALLOWED_CLIENT_HOSTS` (default `claude.ai`). This allowlist is the spec's optional "trust policy". It stops attackers registering look-alike clients, and it removes server-side request forgery risk from fetching arbitrary URLs.
2. Fetch the CIMD document: HTTPS only, no redirects, 5-second timeout, 64 KB cap, JSON. Cache it per its HTTP cache headers, within 5 minutes to 24 hours. Its `client_id` must **exactly** equal the URL.
3. `redirect_uri` must exactly match one in the document. Loopback (`localhost`, `127.0.0.1`, `[::1]`) matches **ignoring the port**.
4. **Until steps 1–3 pass, errors are shown on our own page and never redirected** (OAuth rule: never redirect to an unvalidated URI).
5. Require `response_type=code`, `code_challenge` with method `S256`, `state`, `resource` equal to `<base>/mcp` (RFC 8707), and scope ⊆ `{mcp, offline_access}`. If no scope is sent, it defaults to `mcp`. Anything else in scope is `invalid_scope`.
6. Store the request in `mcp_auth_requests` (10-minute TTL). No session: Flow A sign-in, then return. With a session: show consent.
7. On consent POST: create or reuse the `mcp_grants` row (user + client), issue a code (32 random bytes, stored hashed, **60-second TTL, single use**), and redirect with `code`, `state`, `iss`.

**`POST /oauth/token`** (form-urlencoded; **DB-only, no outbound calls**, so we stay well under Claude's 10-second limit):
- `authorization_code`: the code exists, is unused and unexpired, and `client_id`, `redirect_uri`, and `resource` all match. PKCE check: `BASE64URL(SHA256(code_verifier)) == code_challenge`. **If a code is reused, revoke everything issued from it** (OAuth 2.1 guidance).
- Issue an access token (1 hour) and, if `offline_access` was granted, a refresh token (30-day sliding expiry). Both are opaque and stored hashed.
- `refresh_token`: rotate. The old token is marked used and the new one issued in the same transaction. **Reuse of an already-rotated refresh token revokes the whole grant** (theft detection). Tradeoff: if Claude loses a refresh response and retries, the user must reconnect. That is acceptable and documented.
- Errors use RFC 6749 codes: `invalid_grant`, `invalid_request`, `invalid_client`, `unsupported_grant_type`.

**`POST /oauth/revoke`** (RFC 7009): revoke the token's grant family. Always returns 200.

**If CIMD fails with a real client in M6:** add DCR as a fallback (one `/register` endpoint plus an `mcp_clients` table, with redirect URIs restricted to the same host allowlist). It is deprecated in the 2026-07-28 spec but still supported by Claude. Document it in `DECISIONS.md` if needed.

---

## 12. Reliability

### 12.1 SnapTrade API wrapper

- One `snaptradeFetch()` with a 10-second default timeout. The `fetch` function is **injected** so tests pass a fake, and no test ever hits the real API.
- **Reads** retry up to 2 times on 429, 5xx, or network error. On 429 the wait comes from `X-RateLimit-Account-Reset` or `X-RateLimit-Reset`, then the "Expected available in N seconds" body, then exponential backoff (0.5s, 1s, …) with full jitter, capped at 10 seconds.
- **Writes are never retried automatically** (`/trade/place`, `/trade/impact`).
- On `401`: single-flight refresh (§12.2), retry once, then mark `needs_reauth`.
- Logs only the method, path template, status, duration, and SnapTrade request id. **Never bodies or tokens.**

### 12.2 Token vault and single-flight refresh

- Tokens are encrypted with **AES-256-GCM**: random 12-byte IV per encryption, stored as `v1:<iv>:<ciphertext>:<tag>` (base64). **AAD = `user_id|field`**, which binds a ciphertext to its row so encrypted values can't be swapped between users. The `v1` prefix allows key rotation later.
- **Refresh is lazy:** done when the token is used with fewer than 5 minutes left, or after a 401.
- **Single-flight:** inside a transaction, `SELECT … FROM snaptrade_grants WHERE user_id=$1 FOR UPDATE`, then re-read. If another request already refreshed (expiry now fresh, or the token changed since this request started), use it. Otherwise call SnapTrade (10-second timeout), write the new access **and** refresh token, and commit. Only one refresh per user can ever be in flight. Holding a DB transaction open during a ≤10-second HTTP call is acceptable at our scale; this is documented in `DECISIONS.md`.
- **Test:** fire 10 concurrent API calls with an expired token against a fake token endpoint, and assert the endpoint was called **exactly once** and all 10 succeeded.
- **Failure cases:**
  - `invalid_grant`: delete tokens, `needs_reauth=true`, dashboard banner, tools return a reconnect message.
  - Network error mid-refresh: the token may or may not have rotated at SnapTrade. Retry once with the same refresh token. If that gives `invalid_grant`, ask the user to reconnect. Documented as an accepted edge case.

### 12.3 Caching (protects the 10 requests/min per-account budget)

In-process caches (valid because there is one instance):

| Data | TTL | Invalidated by |
|---|---|---|
| Connections + accounts list | 5 min | Webhooks (`CONNECTION_*`, `NEW_ACCOUNT_AVAILABLE`, `ACCOUNT_REMOVED`), dashboard "Refresh" |
| Positions, balances | 60 s | `ACCOUNT_HOLDINGS_UPDATED`, our own fills |
| Symbol resolution | 24 h | — |
| Quotes | 15 s | — (fetched only on propose and approve, **never polled**) |
| SnapTrade discovery + JWKS | 24 h | Unknown `kid` refetches JWKS (`jose` does this) |

`connection_healthy` uses the cached connection state. If it is older than 5 minutes when a proposal arrives, we refresh `/authorizations` first. That endpoint is customer-level only, not per-account.

### 12.4 Webhooks

`POST /webhooks/snaptrade`:
1. Read the **raw body** (reject anything over 64 KB). Parse it as JSON; if it isn't JSON, return `400`.
2. **Verify the signature before trusting any field:** canonical JSON (keys sorted recursively, separators `,` and `:`, **non-ASCII escaped as `\uXXXX` like Python's default `ensure_ascii=True`**), HMAC-SHA256 with the consumer key, base64, then **constant-time compare** with the `Signature` header. If it fails, return `401` and store nothing. A **fixture test** uses a real signed payload captured in M8. If SnapTrade's actual signing differs, record it in `API_FEEDBACK.md`.
   Then validate with Zod (required fields, `schemaVersion = "oauth_v1"`). If `oauthClientId` isn't ours, return `200` and ignore it (another app on the same SnapTrade customer).
3. **Freshness:** compute `stale = eventTimestamp is more than 5 minutes old`.
4. Insert into `webhook_events` (with `stale`) using `ON CONFLICT (webhook_id) DO NOTHING`. Already seen: return `200` and stop (dedupe).
5. Return **`200` immediately.** Processing happens after the response, and the sweeper retries anything unprocessed, so an event is never lost if the process restarts.
6. **Processing never trusts the payload as state.** It only triggers a re-sync for that user from the API (debounced to at most once per user per 5 minutes for stale events).
   - `CONNECTION_BROKEN` / `FIXED` / `UPDATED` / `ADDED` / `DELETED`: re-fetch `/authorizations` and accounts, then update the banner and block or unblock proposals.
   - `NEW_ACCOUNT_AVAILABLE`: add the account as **not allowed**, and show "New account found".
   - `ACCOUNT_REMOVED`: set the account's `present = false`, so `account_allowed` fails.
   - `ACCOUNT_HOLDINGS_UPDATED`: invalidate the positions and balances cache.
   - Any other type: stored and ignored.

**Why this is safe:** a replayed or stale-but-signed webhook can only cause a harmless re-read of the truth. Dedupe stops exact replays. The freshness flag records suspicious timing without throwing away SnapTrade's legitimate retries, which arrive 30+ minutes later.

**Users who didn't grant the webhook scope** still work, because connection state is refreshed on dashboard load and before proposals (§12.3).

### 12.5 Process lifecycle

- `GET /health`: process up and `SELECT 1` succeeds. Used by Render's health check.
- **Graceful shutdown on SIGTERM** (Render deploys): stop accepting requests, let in-flight ones finish (up to 10 seconds), close the DB pool.
- **Sweeper (every 60 seconds):** expire intents, process unprocessed webhooks, track live orders, move stuck live `EXECUTING` to `UNKNOWN`, and purge expired sessions, login attempts, auth codes, and webhook rows older than 30 days. Each task is idempotent and safe to run late or twice.

---

## 13. Security requirements (non-negotiable)

| Area | Requirement |
|---|---|
| Secrets | `SNAPTRADE_OAUTH_CLIENT_SECRET`, `SNAPTRADE_CONSUMER_KEY`, `TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY` come only from env vars. Never in code, git, logs, the frontend, or error messages. `.env` is in `.gitignore`. Check `git diff` for secrets before every commit. |
| Token storage | SnapTrade tokens: AES-256-GCM at rest (§12.2). Our MCP tokens, auth codes, and session IDs: **SHA-256 hashes only**. |
| Logging | A small JSON logger with a **redaction allowlist** (only known-safe fields are logged). Never codes, tokens, `id_token`s, secrets, full SnapTrade bodies, or account numbers. |
| Sessions | Random 256-bit ID in an `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/` cookie, named with the `__Host-` prefix in production. 24-hour absolute lifetime. **Regenerated at login.** Logout is a POST. |
| CSRF | Every state-changing form is a POST with a per-session CSRF token, plus Hono's `csrf()` Origin check. |
| Approval links | The link alone never approves. It needs session + POST + CSRF. The intent must belong to the session's user (otherwise `404`, never `403`, so IDs can't be probed). Links die with the intent. |
| Login | `state` bound to the browser (login-attempt cookie), PKCE S256, `nonce`, `id_token` fully verified. Attempts expire in 10 minutes and are single-use. |
| Open redirect | Post-login `return_to` must start with `/` and not `//` or `/\`. Otherwise it falls back to `/dashboard`. |
| Headers | Hono `secureHeaders`: CSP `default-src 'self'; frame-ancestors 'none'; form-action 'self'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS in production. No inline scripts (we ship no client JS). |
| Output escaping | Hono JSX escapes by default. **Never** use raw-HTML injection. Data from SnapTrade (security names) is untrusted too. |
| Input validation | Zod at every boundary: HTTP forms, query strings, MCP tool inputs, OAuth parameters, webhooks, **and SnapTrade responses** (parse only the fields we use). Symbols match `^[A-Za-z0-9.\-]{1,20}$`. Quantities and prices are decimal strings parsed with `big.js`. |
| Prompt injection | Assume anything the AI sends may be manipulated by content it read. Defences: (1) the human approval step, showing **our** stored and resolved data rather than AI-written text (no free-text AI fields in v1); (2) the AI has no tool that can approve or loosen rules; (3) server-side limits; (4) proposal rate limits stop approval-spam. |
| MCP OAuth | Client host allowlist, exact redirect match, PKCE required, `resource` bound into tokens, short-lived single-use codes, refresh rotation with reuse detection, consent screen naming the client host and redirect host. |
| Rate limits | Per-user MCP limits (§11.1). Per-IP limits on `/oauth/*` and login (e.g. 30/min). **Not on webhooks:** SnapTrade sends from shared IPs in bursts, and the signature check plus 64 KB body cap protect that route. In-memory, single instance, documented. |
| Live trading | Off by default at server level. Paper-accounts-only by default. Per-user explicit switch. Re-checked at approval. |
| Audit integrity | Postgres trigger blocks `UPDATE` on `audit_events`, and blocks `DELETE` unless the transaction is deleting that user's account (§14.3). |
| Account deletion | User can delete account and all data from the UI (typed confirmation + POST + CSRF). |
| Privacy | A privacy page explains what we store (SnapTrade user id, email, encrypted tokens, account metadata, intents, audit log), why, how long, and how to delete it. We never store brokerage usernames or passwords, because SnapTrade handles brokerage logins. |

---

## 14. Data model (Postgres, Drizzle)

Conventions: `uuid` primary keys (random), `timestamptz` everywhere, money and quantity as `numeric`, `ON DELETE CASCADE` from `users` unless noted.

### 14.1 Tables

```
users
  id uuid pk · snaptrade_sub text unique not null · email text null · email_verified bool
  kill_switch bool default false · mode text check in ('paper','live') default 'paper'
  needs_reauth bool default false · created_at · updated_at

sessions
  id_hash text pk · user_id fk · csrf_token text · created_at · expires_at

login_attempts                       -- pre-login state for SnapTrade OIDC
  id_hash text pk (hash of cookie value) · state text unique · code_verifier_enc text · nonce text
  return_to text null · mcp_auth_request_id uuid null · created_at · expires_at · consumed_at null

snaptrade_grants
  user_id pk fk · access_token_enc text · refresh_token_enc text · access_expires_at
  scope text · updated_at

connections
  id text pk (SnapTrade connection id) · user_id fk · brokerage_name text
  type text ('read'|'trade') · disabled bool · disabled_at null · synced_at

accounts                             -- every account we've seen; the user allows some
  id text pk (our short public ref, e.g. 'acc_7Kq2') · user_id fk · snaptrade_account_id uuid
  connection_id fk · institution_name · name · number_last4 · raw_type · account_category null
  is_paper bool · allowed bool default false · present bool default true · synced_at
  unique(user_id, snaptrade_account_id)

policies
  user_id pk fk · version int · rules jsonb (validated by a versioned Zod schema) · updated_at

mcp_auth_requests                    -- pending /authorize while user signs in / consents
  id uuid pk · client_id text · redirect_uri text · state text · code_challenge text
  scope text · resource text · user_id null · created_at · expires_at

mcp_grants                           -- one per (user, AI client): "Connected AI apps"
  id uuid pk · user_id fk · client_id text · client_host text · scope text
  created_at · last_used_at · revoked_at null

mcp_auth_codes
  code_hash text pk · grant_id fk · redirect_uri · code_challenge · scope · resource
  expires_at · used_at null

mcp_tokens
  token_hash text pk · grant_id fk · kind text ('access'|'refresh') · scope · resource
  expires_at · used_at null (refresh rotation) · revoked_at null · created_at

order_intents
  id uuid pk · user_id fk · account_id fk · grant_id fk null (which AI proposed)
  idempotency_key uuid null · fingerprint text
  symbol text · universal_symbol_id uuid · security_type text · currency text · exchange text null
  side text ('buy'|'sell') · quantity numeric · order_type text ('market'|'limit')
  limit_price numeric null · time_in_force text default 'Day' · mode text ('paper'|'live')
  est_price numeric null · est_value numeric null · price_source text · price_as_of timestamptz null
  status text · check_results jsonb · policy_version int
  created_at · expires_at · decided_at null · updated_at
  unique(user_id, idempotency_key)  ·  index(user_id, created_at)  ·  index(status, expires_at)

executions
  intent_id pk fk · executor text ('paper'|'snaptrade') · client_order_id uuid null
  brokerage_order_id text null · submitted_at null · filled_quantity numeric default 0
  avg_fill_price numeric null · broker_status text null · last_checked_at null
  result jsonb (sanitised) · updated_at

paper_positions
  user_id · account_id · symbol · quantity numeric · avg_cost numeric · currency
  pk(user_id, account_id, symbol)

paper_cash
  user_id · account_id · currency · cash_change numeric · pk(user_id, account_id, currency)

audit_events                         -- append-only
  id bigserial pk · user_id fk · intent_id uuid null · actor text ('ai'|'user'|'system')
  actor_detail text null (e.g. 'claude.ai') · event_type text · details jsonb · created_at

webhook_events                       -- not FK'd to users (may arrive for unknown users)
  webhook_id uuid pk · event_type text · user_sub text · connection_id text null
  account_id text null · event_timestamp · received_at · stale bool · processed_at null
  attempts int default 0 · last_error text null
```

### 14.2 Notes

- No raw tokens or session IDs are stored anywhere. Only `*_enc` (encrypted, for SnapTrade tokens we must send back) or `*_hash` (everything we only need to recognise).
- `webhook_events` stores only routing fields, not the full payload (data minimisation).
- Rate-limit counters and caches live in memory (single instance). This is documented as a known limit of horizontal scaling.

### 14.3 Append-only audit, enforced by the database

```sql
-- Blocks all UPDATEs; allows DELETE only inside the account-deletion transaction,
-- which runs: SET LOCAL app.deleting_user = '<user uuid>';
CREATE FUNCTION audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'audit_events is append-only'; END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.deleting_user', true) IS DISTINCT FROM OLD.user_id::text
    THEN RAISE EXCEPTION 'audit_events rows can only be deleted with their account'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_guard();
```

---

## 15. Tech stack

| Part | Choice | Why |
|---|---|---|
| Runtime | **Node.js 24 LTS** | Node 20 is end of life. 24 is Active LTS until April 2028. |
| Language | TypeScript (strict, ESM) | Strong MCP/OAuth library support, and types catch mistakes. |
| Web framework | **Hono 4** + `@hono/node-server` | Small and readable. Official MCP SDK v2 adapter. Built-in `csrf()` and `secureHeaders()`. |
| UI | Server-rendered **Hono JSX**, plain HTML forms, one small CSS file, **no client JavaScript** | One service, no frontend build, smaller attack surface (strict CSP). |
| MCP | **`@modelcontextprotocol/server` v2 + `@modelcontextprotocol/hono`** | Official SDK. Stateless handler, bearer gate, serves old and new protocol eras. |
| Our OAuth AS | Hand-written (Hono routes) | SDK v2 dropped AS helpers. The subset we need is small and fully explainable (§11.3). |
| Database | **Postgres on Neon** (free plan, pooled connection string) | Row locks for single-flight refresh and execution. Scales to zero, with a sub-second wake that fits inside Claude's 10-second limit. |
| DB driver / ORM | `pg` (node-postgres) + **Drizzle ORM** + `drizzle-kit` migrations | Typed, close to SQL, easy to explain. Real transactions and `FOR UPDATE`. |
| Validation | **Zod 4** | Required by MCP SDK v2. One schema library everywhere. |
| JWT / OIDC | **`jose`** | Verifies SnapTrade `id_token` with JWKS caching and `kid` rotation. (Our own tokens are opaque, not JWTs.) |
| Money maths | **`big.js`** | Exact decimal arithmetic for quantity × price. Tiny, no dependencies. Never JS floats for money. |
| Email | **Resend HTTP API via `fetch`** (no SDK). Logs to console in dev. | One HTTP call, no extra dependency. Needs a verified sending domain to reach other people. |
| Tests | **Vitest**. Integration tests on **real Postgres** (Docker locally, service container in CI). Fake `fetch` injected for SnapTrade. | Concurrency and locking tests need a real Postgres, not an in-memory fake. |
| Dev tooling | `tsx` (run TypeScript in dev), `tsc` (typecheck and build) | Minimal. |
| CI | **GitHub Actions**: install → typecheck → tests (with Postgres service) | Reviewers see green checks, and regressions are caught. |
| Hosting | **Render web service, Starter (paid, about $7/month, always-on)** while the application is live. Free tier only for early smoke tests. | Free instances sleep, and a 30–60 second wake breaks Claude's 10-second OAuth limits. One always-on process keeps in-memory caches and the sweeper simple. Put Render and Neon in the **same region**. |
| Domain | **Recommended:** a cheap custom domain (≈ $10–15/year) | Stable MCP URL and OAuth redirect URIs even if hosting changes. Required for Resend to email anyone besides yourself. Looks professional to reviewers. |
| Logging | Tiny in-house JSON logger with field allowlist | No dependency. Redaction by default. |

**Dependency rule:** ask before adding anything not in this table.

**Alternative considered (documented in `DECISIONS.md`):**
- Vercel Hobby (free, no sleeping). Rejected for v1 because serverless means no in-process sweeper, per-instance memory caches, and more concepts to explain. The code stays portable because all state is in Postgres.
- Express (more examples online). Rejected because Hono has an official SDK adapter and is smaller.

---

## 16. Environment variables (`.env.example` lists names only, no values)

(`OAUTH_REDIRECT_URI` from the original brief is renamed `SNAPTRADE_REDIRECT_URI`, so it's clear which OAuth relationship it belongs to.)

```
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000            # MUST use the same host as SNAPTRADE_REDIRECT_URI (cookies!)
LOG_LEVEL=info

# SnapTrade OAuth (we are a client)
SNAPTRADE_OAUTH_CLIENT_ID=
SNAPTRADE_OAUTH_CLIENT_SECRET=
SNAPTRADE_REDIRECT_URI=http://localhost:3000/oauth/snaptrade/callback
SNAPTRADE_ISSUER=https://api.snaptrade.com
SNAPTRADE_API_BASE_URL=https://api.snaptrade.com
SNAPTRADE_REQUEST_TRADE_SCOPE=false           # only true after SnapTrade enables `trade` for our app
SNAPTRADE_CONSUMER_KEY=                       # only for webhook signature verification

# Database / crypto
DATABASE_URL=                                 # Neon pooled connection string (sslmode=require)
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/guardrail_test   # tests only (Docker)
TOKEN_ENCRYPTION_KEY=                         # 32 random bytes, base64 (openssl rand -base64 32)

# Our OAuth server for MCP clients
MCP_ALLOWED_CLIENT_HOSTS=claude.ai            # comma-separated CIMD client_id hosts

# Email (optional)
RESEND_API_KEY=
EMAIL_FROM=                                   # e.g. approvals@yourdomain.tld (verified in Resend)

# Live trading safety (server-wide)
LIVE_TRADING_ENABLED=false
LIVE_TRADING_PAPER_ACCOUNTS_ONLY=true
```

All variables are validated with Zod at startup, and the process **refuses to start** with a clear message if any required value is missing or malformed (e.g. a key that is not 32 bytes). The resource URL used in tokens is always `APP_BASE_URL + "/mcp"`.

---

## 17. Repository structure

```
/src
  /config        env.ts (Zod-validated env), constants.ts
  /db            schema.ts, client.ts, migrations/, audit-trigger.sql
  /lib           crypto.ts (AES-GCM, hashing), money.ts (big.js helpers), logger.ts, ratelimit.ts, time.ts
  /snaptrade     discovery.ts, oidc.ts (login + id_token), tokens.ts (vault + single-flight),
                 api.ts (fetch wrapper), resources.ts (accounts/positions/quotes/symbols/orders), cache.ts
  /auth          sessions.ts, csrf.ts, login-routes.ts
  /oauth-server  metadata.ts, cimd.ts, authorize.ts, token.ts, revoke.ts, verify.ts
  /mcp           handler.ts, tools/*.ts (one file per tool)
  /policy        types.ts, rules/*.ts, evaluate.ts            (pure, no I/O)
  /intents       state-machine.ts (pure), service.ts (propose/approve/deny/cancel/expire)
  /executors     executor.ts (interface), paper.ts, snaptrade.ts
  /approvals     routes.tsx, email.ts
  /webhooks      verify.ts (canonical JSON + HMAC), routes.ts, processor.ts
  /audit         write.ts
  /jobs          sweeper.ts
  /web           layout.tsx, routes.tsx, pages/*.tsx
  app.ts         createApp(deps): routes + middleware (tests build the app with fakes)
  server.ts      boot, sweeper, graceful shutdown
/public          styles.css (static; outside src because tsc doesn't copy CSS)
/tests
  /unit          policy, state machine, money, crypto, canonical JSON, cimd matching, pkce
  /integration   oidc callback, token refresh concurrency, propose→approve→fill, kill switch,
                 oauth-server flows, webhooks, idempotency
  /fixtures      fake SnapTrade responses, signed webhook samples
/scripts         demo-flow.ts (M5 end-to-end without AI), spike.ts (M2 capability spike)
/claude          BuildFlow.md (step-by-step build plan), Progress.md, ProjectSummary.md, Claude_guide.md
CLAUDE.md          instructions for Claude Code in this repo
.github/workflows/ci.yml
PRODUCT_VISION.md   (this file)
DECISIONS.md        every non-obvious choice: what, why, alternatives
API_FEEDBACK.md     SnapTrade API rough edges + workarounds
THREAT_MODEL.md     short: assets, attackers, mitigations (derived from §13)
README.md
.env.example
```

---

## 18. Build plan (in order; do not skip ahead)

Each milestone ends with its **check passing** and a **plain-English summary for Aaryan**: what was built, how it works, why it was done this way, and what could break.

| M | Milestone | Done when (acceptance check) |
|---|---|---|
| **M0** | **Setup:** repo, Node 24, TS strict, Hono server, Zod env validation, Drizzle + Neon, Docker Postgres for tests, Vitest, CI, `.env.example`, `.gitignore` (includes `.env`). | `GET /health` → `ok` (with DB check). `npm test` passes locally and in CI. App refuses to start with a missing env var. |
| **M1** | **Sign in with SnapTrade:** discovery, PKCE + state + nonce, callback, token exchange, `id_token` verification, user upsert on `sub`, encrypted token storage, sessions, connections + accounts sync, dashboard list (Sandbox data). | Sign-in works end-to-end locally. **Denied consent**, **mismatched state**, and **replayed state** are handled gracefully (tests). Tokens are visibly encrypted in the DB. API path prefix confirmed with a real call. |
| **M2** | **Deploy early + API capability spike:** Render + Neon, deployed callback added in SnapTrade app settings. Then, signed in on Sandbox, *call each endpoint we depend on* (positions/all, balances, quotes, symbol search) and record results. | Sign-in works on the public URL. §21 Q3, Q6, Q9, Q11 answered in `DECISIONS.md` / `API_FEEDBACK.md`. Aaryan told the results. |
| **M3** | **Token lifecycle:** lazy refresh, single-flight lock, 401 → refresh once → retry once → `needs_reauth`, disconnect with revocation. | Concurrency test proves exactly one refresh call. After disconnect, the old refresh token fails at SnapTrade (manual check) and our DB holds no tokens. |
| **M4** | **Policy engine + state machine (pure code):** every rule in §8, `evaluate()`, `transition()`. | Table-driven tests cover every rule's pass **and** fail, every valid transition, and every invalid (state, event) pair. 100% branch coverage on these two modules. |
| **M5** | **Intents, approvals, paper executor:** propose (with idempotency + per-user lock), approval page (§9.2), email, lazy expiry + sweeper, approval re-check, PaperExecutor, audit log, dashboard "Pending approvals". | `scripts/demo-flow.ts` runs propose → approve → `FILLED` with no AI. Tests: double-approve executes once, expired can't be approved, kill switch cancels pending, idempotent retry returns the same intent, two concurrent approvals can't both exceed the daily limit. |
| **M6** | **MCP server + our OAuth AS:** metadata, CIMD authorize, consent, token, revoke, bearer gate, the 8 tools. | In **Claude (web)** and **Claude Code**: add the deployed URL as a custom connector → connect → Claude lists accounts → proposes an order → it shows pending with an approval link → approve in browser → Claude sees `FILLED`. Also verified with MCP Inspector. Revoke in "Connected AI apps" immediately cuts Claude off. |
| **M7** | **Dashboard polish:** policy editor, allowed accounts, intent history, audit log view, kill switch, connected apps, mode display, disconnect, delete account, privacy page, disclaimers. | Every setting demonstrably changes behaviour (manual checklist + integration tests). Account deletion leaves zero rows for that user. |
| **M8** | **Webhooks:** receiver with signature check, dedupe, freshness flag, async processing, connection banner, account changes. | Signed fixture accepted; unsigned or tampered → 401; duplicate ignored; stale flagged; `CONNECTION_BROKEN` blocks proposals for that connection; a real Sandbox webhook (via tunnel or deployed URL) verifies. |
| **M9** | **Live executor** (*only if SnapTrade enables `trade`*): gates (§10.3), place, `UNKNOWN` handling, tracking, impact preview on approval page. | Tested **only** on an `is_paper=true` brokerage account through SnapTrade. Order reaches `SUBMITTED` then `FILLED`/`CLOSED`. Simulated timeout → `UNKNOWN` → reconciled. **Never real money.** |
| **M10** | **Submission polish:** README (what, why, try it in 60 seconds, architecture, tradeoffs, known limits), `DECISIONS.md`, `API_FEEDBACK.md`, `THREAT_MODEL.md`, 2–3 minute demo video + script, switch Render to the always-on plan. | A stranger can understand the project from the README alone. Fresh sign-up works on the public URL. Test-app user slots available for reviewers. |

**If M9 is not unlocked** (trade scope not granted), v1 ships as paper-only. That is a complete product, and the README explains that the live executor is designed, gated, and waiting for SnapTrade's `trade` beta.

---

## 19. Testing

### 19.1 Automated

**Never call real SnapTrade endpoints in automated tests.**

- **Unit:** every policy rule (pass and fail) · every (state, event) pair · money rounding · AES-GCM round trip + tamper detection + AAD mismatch · canonical JSON + webhook HMAC (including non-ASCII) · PKCE S256 · CIMD redirect matching (exact + loopback port-agnostic + reject look-alikes) · `return_to` validation · idempotency fingerprint.
- **Integration (real Postgres, fake SnapTrade `fetch`):**
  - OIDC callback: success, denial, bad state, bad nonce, bad signature, wrong `aud`.
  - Refresh single-flight under 10 concurrent calls.
  - 401 → refresh → retry → `needs_reauth`.
  - Propose → approve → fill.
  - Concurrent approvals and daily limit.
  - Expiry.
  - Kill switch.
  - OAuth AS: full code flow, PKCE failure, code reuse revokes, refresh rotation, refresh reuse revokes grant, wrong `resource` rejected.
  - Webhooks: valid, invalid, duplicate, stale.
  - Account deletion leaves no rows.

### 19.2 Manual checklist (from SnapTrade's OAuth testing guide, plus ours)

1. Consent page lists every requested permission.
2. Consent **denial**.
3. **Mismatched state**.
4. **Expired code**.
5. **Unregistered redirect URI**.
6. `email_verified` reflects reality.
7. Refresh response has no `id_token`.
8. **Refresh-token rotation**.
9. **Forced 401**.
10. **Revocation**: the refresh token no longer works and webhooks stop.
11. **Webhook delivery** on add, reconnect, or remove of a Sandbox connection (`oauth_v1`, correct `oauthClientId` and `userId`).
12. Claude web connect.
13. Claude Code connect (loopback redirect).
14. Kill switch while an approval page is open: approving fails cleanly.
15. Approval link opened in a logged-out browser does nothing until sign-in.

---

## 20. Non-goals for v1

- **No trade recommendations.** The gateway never suggests what to buy or sell.
- **No autonomous trading.** Every order needs human approval, and this cannot be turned off.
- **No options, crypto, mutual funds, margin, or short selling.**
- **No stop or stop-limit orders, no GTC or extended hours.** Market/limit and Day only.
- **No FX conversion.** One policy currency.
- **No cancelling orders at the broker** in v1 (the kill switch explains this).
- **No storing brokerage usernames or passwords.** SnapTrade handles brokerage logins.
- **Not financial advice.** Said in the UI and README.
- **No mobile app, no multi-instance scaling** (single instance by design, documented).

---

## 21. Open questions (do not assume answers)

When we hit one, **stop**, write what we found in `DECISIONS.md`, and tell Aaryan.

| # | Question | Status (2026-10-03) | Fallback if the answer is "no" |
|---|---|---|---|
| Q1 | Will SnapTrade enable `trade` for our Test OAuth app? | Pending (support emailed). | Ship paper-only. Live is designed and gated. |
| Q2 | Is a paper-trading brokerage available through SnapTrade Personal for live testing? | Accounts expose `is_paper`, which suggests some exist. Which brokers is **UNVERIFIED**. | No live testing means no live release. Paper-only. |
| Q3 | Can OAuth Bearer tokens call quotes, symbol search, and order impact? | **UNVERIFIED.** Answer in the M2 spike. | Quotes: position price for held symbols only, labelled. Symbol search: restrict v1 to symbols already held, with type from `positions/all` `instrument.kind` (`stock` maps to stock, `etf` to ETF). Impact: show "Not available". |
| Q4 | Price source for symbols not held? | Depends on Q3. | Reject with "No price available for X". Documented limit. |
| Q5 | Which MCP protocol version does hosted Claude send, and what is its CIMD `client_id` URL? | Claude docs reference spec 2025-11-25 and support CIMD. SDK v2 serves both eras. The hosted-Claude `client_id` URL is **UNVERIFIED** (Claude Code's is `https://claude.ai/oauth/claude-code-client-metadata`). | Log the first real `/authorize` in M6 and set `MCP_ALLOWED_CLIENT_HOSTS`. If CIMD fails, add DCR (§11.3). |
| Q6 | What `raw_type` strings do Sandbox and Wealthsimple return? | **UNVERIFIED.** M2 spike. | Display as-is (we never branch on it). |
| Q7 | Does a retried webhook keep its original `eventTimestamp`? | **UNVERIFIED.** | Our design is safe either way (§12.4). Ask SnapTrade and record in `API_FEEDBACK.md`. |
| Q8 | Does SnapTrade sign webhooks exactly like Python `json.dumps(sort_keys=True, separators=(",",":"))` with default `ensure_ascii`? | Inferred from their sample, **UNVERIFIED** for non-ASCII payloads. | Fixture test with a real webhook in M8. Adjust and record. |
| Q9 | Exact symbol format for TSX listings (e.g. `VFV.TO` vs `VFV`)? | **UNVERIFIED.** M2 spike. | Symbol resolution returns candidates on ambiguity. |
| Q10 | Does `GET /accounts/{id}/recentOrders` let us find an order placed with a given `client_order_id`? | The response schema has **no** `client_order_id` field. | Match by `brokerage_order_id`, or fuzzy-match for `UNKNOWN` plus user confirmation (§10.3). |
| Q11 | Do positions responses include a price usable as a fallback? | The `positions/all` schema includes `units` and `price` fields. How fresh that price is, is **UNVERIFIED**. M2 spike. | Covered by Q3/Q4 fallbacks. |
| Q12 | Does ChatGPT's connector support CIMD? | Not researched. v1 targets Claude. | Add DCR (allowlisted) if we extend to ChatGPT. |

---

## 22. Deep-dive talking points (tradeoffs Aaryan should be ready to explain)

1. **Why a gateway at all:** guardrails in a prompt are suggestions. Guardrails on a server the AI can't modify are enforcement.
2. **Two OAuth roles:** SnapTrade client + our own AS. Claude never holds brokerage-capable tokens.
3. **Human approval as the prompt-injection defence:** we can't stop a model from being manipulated, but we can make manipulation insufficient.
4. **Pure policy and state machine:** testable, deterministic, auditable. All I/O happens before evaluation.
5. **Locks:** per-user row lock (daily limits), intent row lock (no double execution), grant row lock (single-flight refresh). Row locks rather than advisory locks because of PgBouncer.
6. **Never auto-retry an order placement:** an `UNKNOWN` state plus reconciliation beats a possible double order.
7. **Webhooks as hints:** re-read the truth from the API. That makes replay harmless and SnapTrade's 30-minute retries usable.
8. **Opaque hashed tokens vs JWT:** instant revocation, nothing to sign.
9. **CIMD over DCR:** follows the 2026-07-28 spec. The host allowlist removes both the phishing-client and SSRF problems.
10. **Paper default + live gates enforced in code:** "never test on real money" is a config check, not a promise.
11. **Single currency and no FX:** refusing beats guessing with someone's money.
12. **Paid always-on hosting:** measured against Claude's 10-second OAuth timeout, not a vague "free tier is slow".
13. **What I'd do next:** cancel-at-broker, per-currency limits with an FX source, a read-only grant option on the consent screen, TRADE_UPDATE webhook (beta) instead of polling, multi-instance (move caches and rate limits to Postgres or Redis), passkey step-up for live approvals.

---

## 23. Glossary (finance terms in plain words)

| Term | Plain meaning |
|---|---|
| **Brokerage / broker** | The company that holds your investments and places trades for you (e.g. Wealthsimple, Questrade). |
| **Account (TFSA, RRSP, margin, cash)** | A container at a broker. TFSA and RRSP are Canadian tax-advantaged account types. "Margin" means you can borrow money to invest (we don't support borrowing). |
| **Ticker / symbol** | Short code for a security, e.g. `AAPL`, `VFV.TO` (`.TO` = Toronto Stock Exchange). |
| **Stock (common stock)** | A share of ownership in one company. |
| **ETF** | Exchange-traded fund: a basket of many investments that trades like one stock. |
| **Option / crypto / mutual fund** | Other asset types we deliberately don't allow in v1. |
| **Position / holding** | How much of a security you own in an account. |
| **Buy / sell (action, side)** | Buying adds to a position, selling reduces it. |
| **Short selling** | Selling shares you don't own, betting the price falls. Risky, so v1 forbids it. |
| **Market order** | "Buy/sell now at whatever the current price is." Fast, but the price isn't guaranteed. |
| **Limit order** | "Buy only at this price or lower" (or "sell at this price or higher"). The price is guaranteed, but it may never fill. |
| **Stop / stop-limit** | Orders that trigger when a price is crossed. Not supported in v1. |
| **Time in force (Day, GTC)** | How long an order stays active. Day = until today's market close. GTC = until cancelled. v1 uses Day only. |
| **Quote: bid / ask / last** | Bid = highest price a buyer offers. Ask = lowest price a seller accepts. Last = price of the most recent trade. |
| **Delayed quote** | A price that may be some minutes old. |
| **Slippage** | When a market order fills at a different price than you saw. |
| **Fill / partial fill** | The order actually executed (fully, or only part of the quantity). |
| **Notional value** | Quantity × price, the total money size of an order. |
| **Fractional shares** | Buying part of a share (e.g. 0.25). Some brokers allow it. |
| **Buying power** | How much money you can currently spend on trades. |
| **Paper trading** | Simulated trading with fake money. Nothing real happens. |
| **Order impact / preview** | The broker's estimate of what an order will cost and do to your cash, before you place it. |
| **Commission / fees** | What the broker or exchange charges per trade. |
| **FX** | Foreign exchange: converting between currencies (e.g. CAD ↔ USD). |
| **TSX / NYSE / NASDAQ** | Stock exchanges (Toronto, New York). Both run on Eastern Time. |

---

## 24. Sources (checked 2026-10-03)

- SnapTrade docs index: https://docs.snaptrade.com/llms.txt
- SnapTrade *Build an OAuth App*: https://docs.snaptrade.com/docs/oauth-apps.md
- SnapTrade *Trading with SnapTrade*: https://docs.snaptrade.com/docs/trading-with-snaptrade.md
- SnapTrade *Order Impact and Confirmation*: https://docs.snaptrade.com/docs/order-impact-and-confirmation.md
- SnapTrade *Webhooks*: https://docs.snaptrade.com/docs/webhooks.md
- SnapTrade *Rate Limiting*: https://docs.snaptrade.com/docs/ratelimiting.md
- SnapTrade API reference: Place Equity Order, Check Order Impact, Place Checked Order, Get Quotes, Search Account Symbols, List Accounts, List Connections, Recent Orders (`https://docs.snaptrade.com/reference/...`)
- Claude connector authentication: https://claude.com/docs/connectors/building/authentication
- Claude lazy authentication (CIMD example, loopback matching): https://claude.com/docs/connectors/building/lazy-authentication
- MCP spec 2026-07-28 changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
- MCP client registration (CIMD, DCR deprecated): https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- MCP TypeScript SDK v2 (serving, Hono, authorization): https://ts.sdk.modelcontextprotocol.io/v2/
- Node.js release schedule (Node 20 EOL 2026-04-30; Node 24 Active LTS): https://endoflife.ai/article-nodejs-eol
- Render free tier behaviour (15-minute idle spin-down, 30–60s cold start): https://antilak.com/blog/render-free-tier-complete-guide-2026 (re-check Render's own pricing page before paying)
