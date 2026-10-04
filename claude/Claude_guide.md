# Claude Guide — Guardrail Gateway

---

## The Developer

Aaryan Kapoor, 3rd-year CS at UNB. Comfortable with TypeScript and web fundamentals. New to OAuth server-side design, MCP, and finance (explain finance terms in plain words; glossary in `PRODUCT_VISION.md` §23). Goal: a focused, reliable SnapTrade OAuth app he can **defend line by line** in SnapTrade's deep-dive interview.

---

## Working Mode

Aaryan has chosen to have Claude Code **build** this project phase by phase from `claude/BuildFlow.md` ("one-shot" execution), so:

1. **Build exactly what the current phase specifies.** Follow `claude/BuildFlow.md` in order. Read `PRODUCT_VISION.md` for the *why*. Never skip ahead, never add unrequested features.
2. **Explain after every phase.** Plain-English summary: what was built, how it works, why this way, what could break. Aaryan must be able to explain it in an interview. Non-obvious choices go into `DECISIONS.md`.
3. **Stop at ⛔ gates** and at anything unverified (`PRODUCT_VISION.md` §21). Record findings, tell Aaryan, wait.
4. **Teaching commands still work:** `/phase-explain` and `/step-explain` explain concepts without writing code; `/phase-check`, `/progress-log`, `/progress-save` track progress in `claude/Progress.md`.

End every working session with: what's done, what's next, the exact next command, and Progress.md updated.

---

## The 13 Habits

### H1 — Walking Skeleton First
Get something running end-to-end before depth. `/health` with a real DB check before any feature. One real sign-in before token refresh. One tool working through Claude before all eight.

### H2 — Build Vertically, Not Horizontally
One complete slice through every layer before the next: e.g. propose → policy → DB → approval page → paper fill → audit, all working, before the MCP layer exists (P8 before P10).

### H3 — Conventional Commits
`<type>(<scope>): <description>`, imperative, present tense, < 72 chars.
**Types:** feat, fix, chore, test, refactor, docs, ci.
**Scopes:** config, db, crypto, auth, snaptrade, oidc, tokens, sync, web, policy, intents, approvals, executor, paper, live, oauth-server, mcp, webhooks, audit, jobs, ci, docs.
Feature branches `feat/p<N>-<slug>`; fast-forward merge to `main` only when the phase checkpoint passes.

### H4 — Test First on Core Logic
Pure functions: write the test first. Red → Green → Refactor.
**Priority TDD targets:** every policy rule + `evaluate()`; `transition()` (all 221 state/event pairs); `encryptField`/`decryptField`; `pkceChallenge`; `canonicalJson` + `verifySignature`; `redirectUriAllowed`; `safeReturnTo`; money helpers; idempotency fingerprint.

### H5 — Clean Code: Names, Functions, Errors
Names say what a thing is (`proposeOrder`, `expireDue`, `todayCountedValue`). Functions do one thing. Errors carry context and cause:
```typescript
throw new Error('[Tokens] SnapTrade refresh failed', { cause: error })
throw new Error('[OAuthServer] CIMD document client_id mismatch', { cause: error })
```
User-facing messages never leak internals or secrets.

### H6 — YAGNI / KISS / DRY
Build what the current phase needs. Examples to refuse: DCR "just in case" (only if CIMD fails, per gate), FX conversion, cancel-at-broker, multi-instance caching, a frontend framework.

### H7 — Refactor in a Separate Commit
Never mix a refactor with a feature. Finish the feature, commit, then `refactor(<scope>): …`.

### H8 — DevOps Incrementally
- `.gitignore` + branching: day one (done)
- CI (GitHub Actions): Phase 1
- Docker (test Postgres only): Phase 1
- Deploy (Render + Neon): Phase 5; always-on instance before real Claude testing (Phase 10)
- Secrets never in repo — env validated with Zod at startup; the app refuses to start on bad config.

### H9 — Structured Logging
JSON logger with a **field allowlist** (`src/lib/logger.ts`). Never bare `console.log` in app code. Never log tokens, codes, id_tokens, secrets, SnapTrade bodies, or account numbers.

### H10 — Document the Why
Comments explain decisions, not code. Good examples here:
- `// Row lock on users serialises proposals/approvals so two approvals can't both fit under the daily limit`
- `// Never retry /trade/place: a timeout may still have placed the order; we go to UNKNOWN and reconcile`
- `// Python's json.dumps escapes non-ASCII by default; SnapTrade signs that form, so we must too`
Bigger decisions → `DECISIONS.md`; SnapTrade surprises → `API_FEEDBACK.md`.

### H11 — Debug With Method
Reproduce reliably → state a hypothesis → change one variable → read the full error top to bottom. For OAuth: compare exact redirect URIs, cookie host (localhost vs 127.0.0.1), and state values. For locks: reproduce with the concurrency test, not by clicking.

### H12 — Small Working Progress Daily
Every session ends with something that runs, tests green, Progress.md updated. Never leave `main` broken.

### H13 — Test at Every Seam (Most Important)
- **Unit (Vitest):** policy rules, evaluate, state machine, crypto, money, canonical JSON, CIMD redirect matching, return-to validation.
- **Integration (Vitest + real Postgres + fake SnapTrade):** OIDC callback, refresh single-flight, propose/approve races, expiry, kill switch, OAuth server flows, MCP tools via the MCP client, webhooks, account deletion.
- **Manual / E2E:** SnapTrade OAuth testing checklist (`PRODUCT_VISION.md` §19.2), Claude web + Claude Code connector flows, real Sandbox webhook.
No phase passes without its seam tests.

---

## Specific Situations

### "Start Phase X"
Read that phase in `claude/BuildFlow.md` and the cited `PRODUCT_VISION.md` sections. Create the branch. Build the smallest running slice first. Tick checkpoints only with evidence.

### Something in the docs is wrong or unverified
Stop. Check the live docs (`https://docs.snaptrade.com/llms.txt`, append `.md` to pages). Update `PRODUCT_VISION.md` + `BuildFlow.md` in a `docs:` commit before changing code. Tell Aaryan.

### A SnapTrade response doesn't match the docs
Adjust the Zod schema to reality, add an `API_FEEDBACK.md` entry (what the docs say, what we saw, workaround).

### Tempted to add a dependency
Only if it's in `PRODUCT_VISION.md` §15. Otherwise ask Aaryan first.

---

## Route Auth Reference

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/` , `/privacy` | GET | none | Home, privacy |
| `/health` | GET | none | Health check (DB) |
| `/static/*` | GET | none | CSS |
| `/login` | GET | none (per-IP rate limit) | Start SnapTrade sign-in |
| `/oauth/snaptrade/callback` | GET | login-attempt cookie + state | SnapTrade OIDC callback |
| `/logout` | POST | session + CSRF | Sign out |
| `/dashboard`, `/intents`, `/audit`, `/apps`, `/policy`, `/account/delete` | GET | session | Dashboard pages |
| `/accounts/:ref/allow`, `/accounts/refresh`, `/policy`, `/kill-switch`, `/mode`, `/apps/:id/revoke`, `/intents/:id/cancel`, `/intents/:id/not-placed`, `/disconnect`, `/account/delete` | POST | session + CSRF | User actions |
| `/approvals/:id` | GET | session (owner, else 404) | Approval page |
| `/approvals/:id/approve`, `/approvals/:id/deny` | POST | session + CSRF (owner) | Human decision |
| `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server` | GET | none | OAuth discovery |
| `/oauth/authorize` | GET | none → session required to consent | MCP authorization start |
| `/oauth/authorize/resume` | GET | session | Resume after sign-in |
| `/oauth/authorize/decision` | POST | session + CSRF | Consent decision |
| `/oauth/token`, `/oauth/revoke` | POST | public client (PKCE / token possession), form-urlencoded | Token issuance / revocation |
| `/mcp` | POST | Bearer (our opaque token, audience `/mcp`) + per-user rate limit | MCP tools |
| `/webhooks/snaptrade` | POST | HMAC `Signature` header (consumer key) | SnapTrade webhooks |

---

## Red Lines — Never Do These

- Never let any MCP tool approve, change policy, toggle the kill switch, or switch mode
- Never execute an order without a human approval POST (session + CSRF) and a fresh policy re-check
- Never auto-retry `POST /trade/place`
- Never log or return tokens, codes, id_tokens, secrets, or full account numbers
- Never store raw MCP tokens, auth codes, or session ids (hash them)
- Never call real SnapTrade endpoints from automated tests
- Never test live trading on a non-paper account
- Never commit `.env` or any secret
- Never use JS floats for money or quantity
- Never use SQL `now()` for business-time comparisons (use the injected clock as a parameter)
