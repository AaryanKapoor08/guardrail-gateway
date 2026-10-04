# Guardrail Gateway

> **Status: pre-build.** The product vision and step-by-step build plan are complete. Implementation follows `claude/BuildFlow.md`.

**Let an AI assistant trade for you, but only inside rules you set and only after you click Approve.**

Guardrail Gateway is a server-side safety layer between AI assistants (Claude, via MCP) and every brokerage that [SnapTrade](https://snaptrade.com) connects. The AI can read the accounts you allow and **propose** orders. Every proposal is checked against your rules by a pure policy engine, waits for **your explicit approval** on this site, and only then executes. Paper (simulated) trading is the default. Everything is logged. One click stops everything.

- **The AI proposes. Your rules and your approval decide.** The AI has no tool that can approve orders, change limits, or turn off the kill switch.
- Built as a SnapTrade OAuth app (Sign in with SnapTrade).
- **Try it in 2 minutes:** one-click demo, no sign-up (link added at deploy).

## Documents

| File | What it is |
|---|---|
| [`PRODUCT_VISION.md`](PRODUCT_VISION.md) | The full product vision: flows, architecture, policy rules, state machine, security, data model, stack, verified SnapTrade/Claude/MCP facts, open questions |
| [`claude/BuildFlow.md`](claude/BuildFlow.md) | Phase-by-phase build plan with tasks, tests, and checkpoints |
| [`claude/Progress.md`](claude/Progress.md) | Progress tracker |
| [`DECISIONS.md`](DECISIONS.md) | Every non-obvious decision: what, why, alternatives |
| [`API_FEEDBACK.md`](API_FEEDBACK.md) | Rough edges found in SnapTrade's API/docs and how we work around them |

## Not financial advice

Guardrail Gateway never recommends trades. It only enforces the limits you set and asks for your approval.
