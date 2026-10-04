# SnapTrade API Feedback

Rough edges found in SnapTrade's API and docs while building Guardrail Gateway, written as constructive feedback with the workaround we used. Checked against the live docs on 2026-10-03 unless noted.

---

### F1 — `List Account Positions` reference page returns 404
- **Observed:** `llms.txt` still links `reference/Account Information/AccountInformation_getUserAccountPositions.md`, which returns a 404 page. `llms-full.txt` lists `GET /accounts/{accountId}/positions/all` instead.
- **Workaround:** use `/positions/all` (discriminated by `instrument.kind`).
- **Suggestion:** update `llms.txt`, or redirect the old page with a deprecation note.

### F2 — OIDC discovery document doesn't show `revocation_endpoint`
- **Observed:** the OAuth guide's example `/.well-known/openid-configuration` omits `revocation_endpoint`; it's in `/.well-known/oauth-authorization-server`.
- **Workaround:** read both documents at startup.
- **Suggestion:** include `revocation_endpoint` in the OIDC discovery document too (it's a common client expectation).

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

*(Add findings from the build below, especially the P5 capability spike and the P12 real-webhook fixture.)*
