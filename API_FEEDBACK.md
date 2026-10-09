# SnapTrade API Feedback

Rough edges found in SnapTrade's API and docs while building Guardrail Gateway, written as constructive feedback with the workaround we used. Checked against the live docs on 2026-10-03 unless noted.

---

### F1 — `List Account Positions` reference page returns 404
- **Observed:** `llms.txt` still links `reference/Account Information/AccountInformation_getUserAccountPositions.md`, which returns a 404 page. `llms-full.txt` lists `GET /accounts/{accountId}/positions/all` instead.
- **Workaround:** use `/positions/all` (discriminated by `instrument.kind`).
- **Suggestion:** update `llms.txt`, or redirect the old page with a deprecation note.

### F2 — Docs example of the OIDC discovery document is incomplete
- **Observed:** the OAuth guide's example `/.well-known/openid-configuration` omits `revocation_endpoint` and lists only 4 scopes. The **live** document (fetched 2026-10-03) does include `revocation_endpoint`, and the live AS metadata lists scopes `openid, profile, email, read, workspaces:read, trade, webhook`.
- **Workaround:** none needed. We read the live metadata and never hard-code endpoints.
- **Suggestion:** refresh the docs example so readers don't conclude revocation is missing.

### F8 — Undocumented `workspaces:read` scope in live metadata
- **Observed:** `scopes_supported` in `/.well-known/oauth-authorization-server` includes `workspaces:read`, which the OAuth guide's scope table doesn't mention.
- **Workaround:** we don't request it.
- **Suggestion:** document what it grants, or omit it from public metadata if it's internal.

### F3 — Webhook retries vs. the documented 5-minute freshness check
- **Observed:** the verification example rejects payloads whose `eventTimestamp` is more than 5 minutes old, but undeliverable webhooks are retried with backoff starting at 30 minutes. Unless retries update `eventTimestamp`, a client following the example rejects every retry.
- **Workaround:** accept signed stale events, flag them, and treat all webhooks as "re-sync" hints (re-read state from the API).
- **Question:** does a retried webhook keep its original `eventTimestamp`? Consider a separate `deliveryTimestamp` (signed) for replay protection.

### F4 — Webhook signature depends on Python JSON serialisation details
- **Observed:** the signature is HMAC-SHA256 over `json.dumps(payload, separators=(",",":"), sort_keys=True)`. Python escapes non-ASCII characters by default (`ensure_ascii=True`), but JavaScript's `JSON.stringify` doesn't, so non-Python clients must reimplement Python's exact escaping and float formatting.
- **Workaround:** a Python-compatible canonical JSON function with test vectors, plus a real captured payload as a fixture.
- **Suggestion:** sign the raw request body bytes (and a timestamp header), which is language-neutral.

### F5 — Rate-limit retry hints: no `Retry-After`
- **Observed:** 429 handling is documented via `X-RateLimit-Reset` / `X-RateLimit-Account-Reset` headers and a body message ("Expected available in N seconds"), not the standard `Retry-After` header.
- **Workaround:** read those headers, then parse the body, then fall back to exponential backoff with jitter.
- **Suggestion:** also send standard `Retry-After` on 429s.

### F6 — Recent orders can't be matched by `client_order_id`
- **Observed:** Place Equity Order accepts `client_order_id`, but the `recentOrders` response schema doesn't return it, so after a timeout an app can't reliably tell whether its order was placed.
- **Workaround:** match by `brokerage_order_id` when we have it; otherwise fuzzy-match (account, symbol, side, quantity, time window) and fall back to asking the user.
- **Suggestion:** echo `client_order_id` in order responses, and/or offer lookup by it.

### F7 — Legacy `/api/v1` prefix deprecation is only discoverable deep in an endpoint description
- **Observed:** the deprecation (`Deprecation: @1781222400`, 2026-06-12) of the `/api/v1` path prefix is mentioned in the Activities endpoint description, while many examples across the web still use `/api/v1`.
- **Suggestion:** a short "Base URL and versioning" page.

---

## Found while building (2026-10-04)

These come from building against the documented shapes. They are confirmed or corrected with real Sandbox responses during deployment (see "Still to confirm").

### F9 — Webhook field formats aren't specified
- **Observed:** the `oauth_v1` webhook schema lists field names (`webhookId`, `eventTimestamp`, `userId`, …) but not their formats: whether `webhookId` is always a UUID, and whether `eventTimestamp` is ISO 8601 in UTC.
- **Workaround:** we validate `webhookId` as a UUID and `eventTimestamp` as ISO 8601 with an offset; a payload outside that is answered 400 and SnapTrade would retry it, so we will check a real payload before relying on it.
- **Suggestion:** document each field's type and format (and whether `connectionId` / `accountId` can be null for a given event type).

### F10 — Which webhook event types are sent to OAuth apps isn't listed
- **Observed:** the OAuth guide says "supported connection and account events" without naming them; the names we use come from the general webhook list.
- **Workaround:** we act on `CONNECTION_*`, `NEW_ACCOUNT_AVAILABLE`, `ACCOUNT_REMOVED`, and `ACCOUNT_HOLDINGS_UPDATED`, and store-and-ignore anything else.
- **Suggestion:** a table of the event types delivered under `oauth_v1`.

### F11 — Prices arrive as a mix of decimal strings and JSON numbers
- **Observed (from the reference shapes we built against):** position `units` and `price` are decimal strings, while quote prices (`last_trade_price`, `bid_price`, `ask_price`) and balances (`cash`, `buying_power`) are JSON numbers. JSON numbers are parsed as binary floats by most clients, which is risky for money.
- **Workaround:** we convert every number to a decimal string immediately (through its shortest decimal form) and do all maths with a decimal library.
- **Suggestion:** use decimal strings for every money and quantity field, consistently.

### F12 — A sign-in example for MCP-style public clients would help
- **Observed:** apps like ours act as both an OAuth client of SnapTrade and an OAuth server for AI clients (MCP). The docs cover the first role well; how webhooks, refresh rotation, and revocation interact with a second token layer is left to the developer.
- **Suggestion:** a short "building an AI agent gateway on SnapTrade" guide (keep SnapTrade tokens server-side; issue your own tokens to the AI; revoke both on disconnect).

### F13 — Account-scoped symbol search returns 501 on the Sandbox brokerage
- **Observed (2026-10-09, real OAuth token):** `POST /accounts/{id}/symbols` answers 501 for the Sandbox "Individual" account, while `GET /accounts/{id}/quotes?use_ticker=true` works and returns the full universal-symbol object.
- **Impact:** an app built and tested on the Sandbox can't exercise its symbol-resolution path; ours now falls back to a quote by ticker (D27).
- **Suggestion:** support symbol search on the Sandbox, or list per-brokerage endpoint support (which calls return 501) in the docs.

## Confirmed with real responses (P5 spike, 2026-10-09)

| Question (PRODUCT_VISION §21) | Answer | Where |
|---|---|---|
| Q3 — can OAuth tokens call quotes and symbol search? | Quotes: yes. Symbol search: 501 on the Sandbox; we fall back to a quote by ticker | D27, F13 |
| Q6 — `raw_type` strings | `Individual`, `IRA` (Sandbox); `MSB`, `CARD` (Wealthsimple). Shown as-is | D27 |
| Q9 — TSX symbol format (`VFV.TO` vs `VFV`) | Not testable on the US-only Sandbox; we compare both `symbol` and `raw_symbol` | D27 |
| Q11 — position `price` usable as a fallback | Yes, a decimal string with `data_freshness.as_of`; used only when no quote is available | D27 |

## Still to confirm with real webhooks (P12)

| Question (PRODUCT_VISION §21) | What we assumed | Where |
|---|---|---|
| Q7 — does a retried webhook keep its `eventTimestamp`? | Either way is safe (stale events are re-sync hints) | D23, F3 |
| Q8 — is the webhook signature exactly Python's `json.dumps(sort_keys=True, separators=(",",":"))` with `ensure_ascii`? | Yes; tests compare with Python-generated vectors; the real fixture test is ready | D23, F4 |
