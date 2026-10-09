# Handoff — record the demo video and submit

Written 2026-10-09 (early morning). Everything below is done and live unless it says **TODO**.

## ⚠ Deadline

SnapTrade's page says **"Submissions close Friday, October 9"**, which is **today (2026-10-09)**. Record and submit **before midnight tonight**. If you wait until Saturday Oct 10, the form may already be closed.

## Where things are

| What | Where |
|---|---|
| Live app | https://guardrail-gateway-xbqm.onrender.com |
| Claude connector URL | https://guardrail-gateway-xbqm.onrender.com/mcp |
| Code | https://github.com/AaryanKapoor08/guardrail-gateway (tag `v1.0.0`, CI green) |
| Video script (90 s) | `docs/demo-script.md` |
| Render service | `srv-db47svbncjis73c46lt0` (free, Virginia), dashboard.render.com |
| SnapTrade OAuth app | `PROJECT-TEST-MTDRW`; redirect URI for the live site already added |

## State of your account on the live site (already set up)

- Signed in with SnapTrade as aaryan.kapoor@unb.ca.
- **Allowed:** sandbox → Individual (••••-001). Not allowed: sandbox IRA and both Wealthsimple accounts (keep it that way).
- **Policy:** currency **USD**, per-order **$250**, daily **$600** (needed because the Sandbox trades in USD).
- Claude (claude.ai) has the **Guardrail Gateway** connector added and working.
- 1 × AAPL was already approved and filled at $180.50 (paper) on Oct 9 as a test. It counts toward Oct 9's daily total ($600 limit, Toronto calendar day), so on Oct 9: 5 × AAPL is still rejected, and 1 × AAPL still passes ($361 total).
- Sandbox prices are fixed: AAPL $180.50, MSFT $410, SPY $558.25. Canadian tickers (VFV.TO) don't exist on the Sandbox; the instant demo uses them instead.

## Before you hit record (10 minutes)

1. Open https://guardrail-gateway-xbqm.onrender.com and wait until it loads (the free server sleeps after 15 idle minutes; the first load takes ~30 s). Click around once so it's warm.
2. Check you're signed in (top bar shows "Paper mode · Dashboard · …"). If not: Sign in → Sign in with SnapTrade.
3. Kill switch must be **off** (no red bar under the navbar).
4. Policy page shows USD / 250 / 600.
5. Open claude.ai in a second tab, **new chat**, make sure the Guardrail Gateway connector is enabled for the chat.
6. Browser zoom 110–125 %, close other tabs, hide bookmarks bar. Never show `.env`, tokens, or the Wealthsimple account numbers up close.

## Recording (follow `docs/demo-script.md`, 60–90 s)

1. **0:00–0:10** Home page (scroll the bento a little). Problem in one sentence.
2. **0:10–0:20** Dashboard (accounts, only Individual allowed) → Policy page.
3. **0:20–0:35** Claude: *"Buy 5 shares of AAPL in my Individual account"* → rejected with both reasons.
4. **0:35–1:00** *"OK, buy 1 share instead"* → open the link → approval page (summary, checks, PAPER badge) → **Approve** → "Filled".
5. **1:00–1:10** Claude: *"What's the status of that order?"* → FILLED.
6. **1:10–1:22** Dashboard → **Turn the kill switch on** (red bar) → **Audit log**.
7. **1:22–1:30** Home page → "Try the demo". 
8. **Afterwards: turn the kill switch off.**

Tip: do one dry run first. If Claude words things differently, that's fine; keep talking over it.

## Submit

1. Upload to YouTube as **Unlisted**. Open the link in a private window to check it plays without signing in.
2. Submission form (on SnapTrade's "Build something" page):
   - Project: Guardrail Gateway
   - Live: https://guardrail-gateway-xbqm.onrender.com
   - Code: https://github.com/AaryanKapoor08/guardrail-gateway
   - Video: your YouTube link
   - One line: *"A safety layer that lets AI assistants like Claude propose trades on SnapTrade-connected accounts, but only within limits you set and only after you approve, with a kill switch and a full audit log."*
3. Check you meet the eligibility rule in their terms (Hack Atlantic 2026 participants/attendees).

## TODO (nice to have, not blocking)

- **UptimeRobot** (free): New Monitor → HTTP(s) → `https://guardrail-gateway-xbqm.onrender.com/health` → every 5 min. Keeps the site awake while SnapTrade reviews it.
- Real webhook capture (P12), Claude Code connection (untested), live trading (P13, deliberately not built: no paper-trading brokerage). All documented in README "Known limits".

## If something breaks

- **Site shows an error / won't load:** wait 60 s (cold start) and reload. Still broken → Render dashboard → the service → Logs.
- **Redeploy after a code change:** pushing to `main` does **not** auto-deploy (no Render GitHub app). In Render: service → **Manual Deploy → Deploy latest commit**. (Or ask Claude Code; it has a script that calls the Render API with `RENDER_API_KEY` from `.env`.)
- **Claude says the connector needs to reconnect:** claude.ai → Settings → Connectors → Guardrail Gateway → reconnect → Allow.
- **"AAPL trades in USD, but your limits are in CAD":** Policy page → Currency USD → Save (needs no pending orders).
- **Order rejected for the daily limit:** you used up today's $600. Raise the daily limit on the Policy page, or use 1 × AAPL only.
- **Local dev:** `npm run dev` (uses `.env`, same Neon DB as production), tests: `npm run db:test:up && npm test`.

## What changed in this session (2026-10-09)

- Fixed 23 MCP tests broken by the real date passing the fixed test date (SDK checks expiry against the real clock).
- Deployed to Render (P5); real SnapTrade sign-in works; capability spike done (D27, F13).
- Sandbox symbol search returns 501 → the app now finds tickers through a quote (`use_ticker=true`); verified live.
- Real Claude flow verified end to end (reject → propose → approve → FILLED).
- Full visual redesign after ShoreCheck (D28): dark glass theme, pill navbar, bento home page, two-column approval page, self-hosted Inter. 727 tests pass.
