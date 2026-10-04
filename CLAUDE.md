# CLAUDE.md — Guardrail Gateway

Read these before writing any code, in this order:
1. `PRODUCT_VISION.md`: what we build, why, hard rules, verified external facts (the source of truth).
2. `claude/BuildFlow.md`: exact build order, per-phase tasks, tests, checkpoints, commit messages.
3. `claude/Progress.md`: where we are. Work only on the current phase.
4. `claude/Claude_guide.md`: working mode, the 13 habits, route auth table, red lines.

## Project in one line
A server-side safety layer between AI assistants (via MCP) and SnapTrade-connected brokerages: the AI proposes orders, a pure policy engine checks them, a human approves on our site, then (paper by default) they execute. Built for a SnapTrade internship application, so **Aaryan must be able to read, explain, and defend every line**.

## Rules for working in this repo
- **Follow BuildFlow phase by phase.** No skipping ahead, no speculative features, no abstractions for single-use code.
- **State assumptions. If unclear or two approaches are reasonable, ask.** Stop at every ⛔ gate.
- **Surgical changes.** Touch only what the task needs.
- **Every phase:** `npm run check` (lint + typecheck) and tests green, checkpoint items ticked with evidence, `claude/Progress.md` updated, plain-English summary to Aaryan (what / how / why / what could break).
- **Record decisions** in `DECISIONS.md` (what, why, alternatives) and **SnapTrade API friction** in `API_FEEDBACK.md`.
- **Don't invent API behaviour.** SnapTrade docs: https://docs.snaptrade.com/llms.txt (append `.md` to any page). MCP SDK v2: installed types/docs in `node_modules` and https://ts.sdk.modelcontextprotocol.io/v2/.
- **Dependencies:** only those in `PRODUCT_VISION.md` §15. Ask before adding anything else. Prefer the Node standard library (`fetch`, `node:crypto`, `AbortSignal.timeout`, `structuredClone`).
- **Secrets:** env vars only; `.env` is git-ignored; check `git diff --cached` before every commit.
- **Commits:** small, conventional (`feat(scope): …`), one logical change each, on `feat/p<N>-<slug>` branches, fast-forward merged to `main` when the phase passes.
- **Never call real SnapTrade endpoints in automated tests. Never test live trading on real money.**
- **Docker hygiene:** only ever remove containers/volumes **by exact name** that this project created (e.g. `docker rm -f gg-…`). Never `docker … prune` or bulk-remove; other projects share this machine.
- Aaryan has no finance background: explain finance terms plainly.

---

# Coding Standards

The goal: **code a new teammate can read top to bottom and understand on the first pass.** Plain words, small pieces, no cleverness. When two versions work, pick the one that is easier to explain.

## 1. Plain language (no jargon)
- **Names say what a thing is or does, in full words.** `approvalWindowMinutes`, not `apprWin`. `proposeOrder()`, not `handleOP()`. Only standard short forms: `id`, `url`, `db`, `api`, `html`.
- **Functions are verbs** (`expireDueIntents`, `resolveSymbol`). **Booleans read as yes/no questions** (`isPaper`, `hasOpenIntents`, `canGoLive`). **Units go in the name** (`timeoutMs`, `expiresAt`, `maxOrderValue`).
- **Use the product's own words everywhere**, the same in code, UI, database, and docs: *intent*, *policy*, *rule*, *approval*, *kill switch*, *paper mode*, *live mode*, *allowed account*. Don't invent synonyms (`order request` vs `trade ticket` vs `intent` for the same thing).
- **User-facing text is plain English.** No error codes, stack traces, or acronyms on screen. Say what happened and what to do next: *"Couldn't get a fresh price from your broker. Try again in a minute."*
- **Comments explain *why*, never *what*.** If code needs a "what" comment, rename or split it instead. Keep comments on non-obvious decisions, with the reason:
  `// Never retry: a timeout may still have placed the order. We mark it UNKNOWN and reconcile.`
- No commented-out code. No `TODO` without a phase number (`// TODO(P13): …`).

## 2. Small, single-purpose pieces
- **One function, one job.** Aim for ≤ 40 lines. If you need "and" to describe it, split it.
- **Max 3 positional parameters**; beyond that, pass one named object (`proposeOrder(deps, { accountRef, symbol, side, … })`).
- **No boolean "mode" flags** that switch behaviour (`save(x, true)`). Write two clearly named functions.
- **Early returns instead of nested `if`s.** Handle the bad cases first, then the main path at the left margin.
- **One concept per file**, file names in `kebab-case.ts`. **Named exports only** (no `export default`, except where a tool requires it), so names stay the same everywhere they are used.
- **Pure core, thin shell.** Business decisions (policy rules, state machine, money maths) are pure functions with no I/O. Route handlers stay thin: *parse input → call one service function → render or redirect*. Services do the I/O.

## 3. Types (TypeScript 7, strict)
- `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, **`erasableSyntaxOnly`** (no `enum`, no `namespace`, no constructor parameter properties). Use plain JS that TypeScript only *annotates*.
- **No `any`.** Unknown data is `unknown` until a Zod schema parses it. **No non-null `!`** outside tests.
- **One source of truth for shapes:** define the Zod schema, derive the type with `z.infer<typeof Schema>`. Never hand-write a type that duplicates a schema.
- **Fixed sets are string unions or `as const` arrays**, not enums: `const SIDES = ['buy', 'sell'] as const; type Side = typeof SIDES[number]`.
- Use `type`, not `interface`, for consistency. Mark data that shouldn't change as `readonly`.
- **Make impossible states impossible**: a discriminated union (`{ ok: true, security } | { ok: false, reason }`) beats optional fields that "should" be set together.

## 4. Errors and outcomes
- **Expected outcomes are return values; failures are thrown.** A policy rejection, an expired intent, or an unknown symbol is a normal result the caller handles. A database outage or a bug is an exception.
- Throw our typed errors from `src/lib/errors.ts` with context and cause: `throw new Error('[Tokens] SnapTrade refresh failed', { cause: error })`.
- **Never swallow errors.** Every `catch` either handles the error meaningfully (and says why in a comment) or rethrows. Fire-and-forget work (email, webhook processing) must end with `.catch(logError)` and a comment saying why it's safe to not wait.
- Error messages shown to users or the AI are written for them, and never include tokens, SQL, stack traces, or raw SnapTrade bodies.

## 5. Async and I/O
- **Every promise is awaited or returned.** (The linter enforces no floating promises.)
- **Run independent I/O in parallel** with `Promise.all` (e.g. quote + positions); keep dependent steps sequential and readable.
- **Every network call has a timeout** (`AbortSignal.timeout(ms)`), and every retry has a cap and backoff with jitter. Never retry an order placement.
- **Do network calls *before* opening a database transaction**, never while holding a lock, except the token refresh, which is the documented exception (V§12.2).
- No module-level mutable state. Caches, pools, and limiters are created once in `createDeps()` and passed in, so tests can replace them.

## 6. Database
- **Every state change = one transaction** containing: the row lock, the `transition()` check, the `UPDATE … WHERE status = $current`, and the audit row. All or nothing.
- **Lock order is always: `users` row → `order_intents` row → anything else.** The same order everywhere prevents deadlocks.
- Queries go through Drizzle (parameterised). Raw SQL only via Drizzle's `sql` template, **never string concatenation**.
- **Select only the columns you use.** No queries inside loops (avoid N+1); fetch in one query.
- Every column used in a frequent `WHERE`/`ORDER BY` has an index (V§14).
- Money and quantities: `numeric` in Postgres, decimal strings at the edges, `big.js` in code. **Never JS `number` maths on money.**
- Time: business-time comparisons use the injected clock as a SQL parameter (`$now`), never SQL `now()`.

## 7. HTTP and HTML
- **Validate at the edge, trust inside.** Every request body, query string, form, OAuth parameter, MCP tool input, webhook, and SnapTrade response is parsed by Zod at the boundary. Inner code receives typed, valid data.
- Status codes: 400 bad input · 401 not signed in / bad token · 403 CSRF or forbidden action · 404 not found **or not yours** (never reveal another user's data exists) · 409 conflict · 429 rate limited · 5xx our fault.
- Server-rendered pages: Hono JSX only (it escapes by default). **Never inject raw HTML.** No client-side JavaScript.
- Every state-changing action is a `POST` with a CSRF token. `GET` never changes anything (except reflecting time, like expiry).

## 8. Security by default
- Secrets only from validated env. Tokens encrypted (SnapTrade) or hashed (ours). Nothing secret in logs, errors, URLs, or audit details.
- Least data: store and return only what a feature needs (last 4 digits of account numbers, no full payloads).
- Full red-line list: `claude/Claude_guide.md`.

## 9. Tests
- **Test behaviour, not implementation.** Name tests as sentences about the product: `it('rejects an order over the per-order limit')`.
- **Arrange → Act → Assert**, one behaviour per test, no logic (loops/ifs) in tests except table-driven cases.
- **Deterministic:** controllable clock, fake SnapTrade via injected `fetch`, real Postgres for integration tests, no sleeps (use fake timers), no test depending on another's data.
- Use small builder helpers for test data (`buildIntent({ side: 'sell' })`), not giant fixtures.
- Pure logic: test first (red → green → refactor). Every bug fix starts with a failing test.
- No snapshot tests for logic.

## 10. Tooling that enforces all this
- **Biome** (formatter + linter, one fast tool): `npm run lint` must pass. Formatting is never debated; the tool decides.
- **TypeScript 7** (`tsc`, the native compiler): `npm run typecheck` must pass with zero errors.
- `npm run check` = lint + typecheck. CI runs `check` + tests on every push.

## 11. "Optimal" means simple first, measured second
- The fastest code to read, change, and debug wins over the fastest to run, unless a measurement says otherwise.
- Built-in efficiency we *do* rely on: indexed queries, no N+1, short-TTL caches for SnapTrade data (V§12.3), parallel independent I/O, opaque-token lookups by indexed hash.
- Don't optimise without evidence (a slow test, a log timing, a rate-limit hit). When you do, note the measurement in `DECISIONS.md`.
