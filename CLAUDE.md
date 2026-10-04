# CLAUDE.md — Guardrail Gateway

Read these before writing any code, in this order:
1. `PRODUCT_VISION.md`: what we build, why, hard rules, verified external facts (the source of truth).
2. `claude/BuildFlow.md`: exact build order, per-phase tasks, tests, checkpoints, commit messages.
3. `claude/Progress.md`: where we are. Work only on the current phase.
4. `claude/Claude_guide.md`: working mode, the 13 habits, route auth table, red lines.

## Project in one line
A server-side safety layer between AI assistants (via MCP) and SnapTrade-connected brokerages: the AI proposes orders, a pure policy engine checks them, a human approves on our site, then (paper by default) they execute. Built for a SnapTrade internship application, so **Aaryan must be able to defend every line**.

## Rules for working in this repo
- **Follow BuildFlow phase by phase.** No skipping ahead, no speculative features, no abstractions for single-use code.
- **State assumptions. If unclear or two approaches are reasonable, ask.** Stop at every ⛔ gate.
- **Surgical changes.** Touch only what the task needs.
- **Every phase:** typecheck + tests green, checkpoint items ticked with evidence, `claude/Progress.md` updated, plain-English summary to Aaryan (what / how / why / what could break).
- **Record decisions** in `DECISIONS.md` (what, why, alternatives) and **SnapTrade API friction** in `API_FEEDBACK.md`.
- **Don't invent API behaviour.** SnapTrade docs: https://docs.snaptrade.com/llms.txt (append `.md` to any page). MCP SDK v2: check installed types/docs in `node_modules` and https://ts.sdk.modelcontextprotocol.io/v2/.
- **Dependencies:** only those in `PRODUCT_VISION.md` §15. Ask before adding anything else.
- **Secrets:** env vars only; `.env` is git-ignored; check `git diff --cached` before every commit; never log tokens, codes, id_tokens, secrets, SnapTrade bodies, or account numbers.
- **Commits:** small, conventional (`feat(scope): …`), one logical change each, on `feat/p<N>-<slug>` branches, fast-forward merged to `main` when the phase passes.
- **Never call real SnapTrade endpoints in automated tests. Never test live trading on real money.**
- Aaryan has no finance background: explain finance terms plainly.
