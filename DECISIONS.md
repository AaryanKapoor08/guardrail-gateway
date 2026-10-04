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
