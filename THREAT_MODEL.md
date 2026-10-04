# Threat Model

What Guardrail Gateway protects, who might attack it, and what stops each attack. Each mitigation points to where it is built and tested. Security requirements in full: `PRODUCT_VISION.md` §13.

---

## Assets

| Asset | Why it matters |
|---|---|
| The user's money and positions | A wrong or unauthorised order is the worst outcome. In paper mode nothing reaches a broker, but the same guardrails will guard live mode. |
| SnapTrade access and refresh tokens | They read the user's brokerage accounts (and, with the `trade` scope, could place orders). |
| The approval decision | The one step that turns a proposal into an execution. |
| Our MCP tokens and grants | They let an AI app act for the user (propose, never approve). |
| The audit log | The user's record of what happened and who did it. |
| Personal data | Email, SnapTrade user id, account names, last 4 digits of account numbers, orders. |
| Server secrets | SnapTrade client secret, consumer key (webhook signatures), token encryption key, Resend key. |

## Trust boundaries

```
 untrusted                         │ our server (trusted)                 │ trusted third parties
 ─────────────────────────────────┼──────────────────────────────────────┼──────────────────────
 AI model and anything it reads ──┼─► /mcp (bearer token, Zod inputs) ───┼─► SnapTrade API
 MCP client apps (Claude) ────────┼─► /oauth/* (PKCE, CIMD allowlist)    │   (responses still
 the user's browser ──────────────┼─► web pages (session, CSRF, CSP)     │    parsed with Zod)
 the internet (webhook senders) ──┼─► /webhooks (HMAC signature)         │
                                  │   Postgres (Neon): tokens encrypted  │
```

The AI is treated as untrusted even when the user's own Claude runs it: anything it read (a web page, an email, a document) may have manipulated it.

---

## Attackers and mitigations

### 1. Malicious content steers the AI (prompt injection)
*Goal:* make the AI buy or sell something the user didn't want.
- **Human approval is mandatory and can't be turned off** (`approval_required`); the AI has **no tool** to approve, deny, change limits, allow accounts, use the kill switch, or switch mode (`src/mcp/handler.ts`, tested: the tool list is exactly 8 read/propose/cancel tools).
- The approval page shows **our own resolved data** (symbol from SnapTrade's symbol search, our price estimate, account from our database), never text the AI wrote; there are no free-text AI fields.
- Server-side policy the AI can't modify: limits, allowlist/denylist, sides, asset types, currency, daily totals including pending orders, re-checked at approval with fresh data.
- Proposal rate limit (10/min per user) and the duplicate-order warning stop approval spam.
- Paper mode by default; live mode needs server flags, the `trade` scope, a trade-enabled connection, a paper brokerage account, and an explicit user switch.

### 2. A stolen MCP token
*Goal:* act as the user's AI app.
- The token can only read allowed accounts and **propose**; every order still needs the user's approval on our site.
- Access tokens last 1 hour; they are bound to our `/mcp` URL (`resource`), so they are useless elsewhere.
- Tokens are stored only as SHA-256 hashes; a database leak doesn't reveal usable tokens.
- Refresh tokens rotate; **reusing an old one revokes the whole grant** (theft detection). Reusing an authorization code does the same.
- The user can disconnect the app (Connected AI apps), disconnect SnapTrade, or hit the kill switch; revocation is immediate because tokens are looked up on every request.

### 3. A phishing or look-alike MCP client
*Goal:* get the user to connect a malicious app.
- Client ID Metadata Documents are only accepted from allowlisted hosts (`MCP_ALLOWED_CLIENT_HOSTS`, default `claude.ai`), over HTTPS, with the document's `client_id` equal to its URL.
- Redirect URIs must exactly match the registered ones (loopback only on the same host and path, any port).
- The consent screen names the **host of the client_id URL** (not the name the app claims), the host it will redirect to, and warns when that is a program on the user's own computer.
- PKCE S256 is required; codes are single-use and live 60 seconds; responses carry `iss`.
- Errors before the client and redirect are verified are shown on our own page, never redirected.

### 4. A fake approval link
*Goal:* trick the user into approving on a look-alike site, or into approving something else.
- An approval needs a signed-in session on our domain, a POST, and a CSRF token; the link alone does nothing (email scanners can open it safely).
- Pending approvals are also listed on the dashboard, an independent channel; the consent and approval pages show our host.
- Another user's intent answers 404, so ids can't be probed.

### 5. A forged or replayed webhook
*Goal:* change what we believe about the user's accounts.
- HMAC-SHA256 signature with our consumer key over Python-compatible canonical JSON, compared in constant time, checked **before** any field is trusted; failures store nothing (401).
- 64 KB body cap; Zod validation; events for another OAuth client are ignored.
- Webhooks are **only hints**: processing re-reads connections, accounts, or holdings from SnapTrade's API. A replay can only cause a harmless re-read; exact replays are deduplicated by `webhookId`; stale events are flagged and debounced.

### 6. Cross-site request forgery and clickjacking
*Goal:* make the user's browser approve, change settings, or delete data.
- Every state change is a POST with a per-session CSRF token, plus an Origin check against our configured origin (tested: every POST route refuses a missing token).
- `GET` never changes state (it may only reflect expiry).
- `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; form-action 'self'` (the consent page adds only the app's redirect origin) and `X-Frame-Options: DENY`; no client-side JavaScript at all.
- Session cookies are `HttpOnly`, `SameSite=Lax`, `Secure` with the `__Host-` prefix in production.

### 7. Someone reads the database (insider, leaked backup)
*Goal:* use what is stored.
- SnapTrade tokens are encrypted with AES-256-GCM; the key lives only in the environment; the associated data (`user_id|field`) stops a ciphertext from being moved to another user.
- Our tokens, authorization codes, and session ids are stored only as SHA-256 hashes.
- Account numbers are stored as the last 4 digits only; no brokerage credentials ever reach us (SnapTrade handles brokerage logins).
- Logs use an allowlist of fields, so tokens, codes, bodies, and account numbers can't be logged by mistake (tested).

### 8. Hijacking the sign-in
*Goal:* sign in as someone else, or keep a planted session.
- OIDC with PKCE, `state` bound to a login-attempt cookie, `nonce`, full `id_token` verification (issuer, audience, signature, expiry); login attempts are single-use and expire in 10 minutes.
- A new session id at every sign-in (session fixation); 24-hour absolute lifetime; logout is a POST.
- The post-login return path accepts only same-site paths (`//evil.com` and `/\evil.com` are refused).

### 9. Reading or changing another user's data
- Every query is scoped by the signed-in user's id; another user's intent, account, or app answers 404.
- `account_ref` is our own opaque id, never SnapTrade's account id; MCP tools take the user only from the verified token, never from input (an extra `user_id` field is refused).
- The account sync never links a user's account to another user's connection row (tested).

### 10. Double execution and race conditions
- Per-user row lock (`SELECT … FOR UPDATE` on `users`) around every proposal, approval, cancel, kill switch, mode change, and policy change; the intent row lock and `UPDATE … WHERE status = $current` make each transition happen once (tested with concurrent approvals).
- Idempotency keys; a live order placement is never retried automatically (design for P13).

### 11. Server-side request forgery
- The only URL we fetch on someone else's behalf is a CIMD document: allowlisted host, HTTPS, no redirects, 5-second timeout, 64 KB byte-counted cap.

### 12. Tampering with the audit log
- A Postgres trigger blocks every `UPDATE` and every `DELETE` of audit rows, except inside the account-deletion transaction for that same user. Audit rows are written in the same transaction as the change they record.

### 13. Abuse and denial of service
- Per-IP limits on sign-in and OAuth (30/min) and demo starts (5/hour, at most 300 demo users); per-user MCP limits; body caps; a timeout on every outbound call; caches that protect SnapTrade's 10 requests/minute per-account budget.

### 14. Leaked secrets in the repository
- Secrets come only from environment variables; `.env` is git-ignored; CI uses obviously fake values; the app refuses to start with invalid configuration and names only the variable.

---

## Accepted risks

- **The human is the last line of defence.** A user who approves without reading can still approve a bad order; the limits cap the damage.
- **Per-IP limits trust the first `X-Forwarded-For` address.** A forged header only dodges the brake, not any real protection.
- **Single instance:** in-memory caches and rate limits reset on restart.
- **Consent phishing with a genuine client:** an attacker could start a real Claude connection and send the user the authorize link; the consent screen's clear wording is the defence.
- **Email is best effort** and only a convenience; the dashboard and the link returned to the AI are the reliable channels.
- **A refresh request lost in the network** may leave a rotated SnapTrade token unknown to us; the user then reconnects (documented in `PRODUCT_VISION.md` §12.2).

Not financial advice. Guardrail Gateway never recommends trades.
