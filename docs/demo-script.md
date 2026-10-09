# Demo video script (90 seconds)

**Goal:** show that an AI can propose trades but can never act without passing the user's rules and the user's own click, and that every step is recorded.

**Set up before recording**
- Live site (https://guardrail-gateway-xbqm.onrender.com) open and signed in with SnapTrade; the SnapTrade Sandbox **Individual** account is **Allowed**, the others are not. Load the site once first so the free server is awake.
- **Policy** page: policy currency **USD** (the Sandbox is a US brokerage), per-order limit **$250**, daily limit **$600**. Save.
- Claude (claude.ai) with the Guardrail Gateway connector already added and allowed, in a fresh chat.
- Sandbox prices are fixed: AAPL $180.50, MSFT $410, SPY $558.25.
- Zoom the browser to 125% so text is readable. Never show real account numbers, `.env`, or tokens.

---

### 0:00–0:10 — The problem
**Show:** the dashboard.
**Say:** "AI assistants can now reach brokerage accounts through SnapTrade. Guardrail Gateway makes sure an AI can only *propose* trades: my rules check them on a server the AI can't touch, and nothing happens until I approve."

### 0:10–0:20 — Signed in with SnapTrade
**Show:** the accounts table (Sandbox accounts, only Individual allowed), then the Policy page.
**Say:** "I signed in with SnapTrade's OAuth. The AI sees only the accounts I allow, and these are my limits: $250 an order, $600 a day."

### 0:20–0:35 — A proposal that breaks the rules
**Do:** In Claude: *"Buy 5 shares of AAPL in my Individual account."*
**Show:** rejected, with the per-order and daily limit reasons.
**Say:** "Every rule runs, and Claude gets every reason in plain English. Nothing was placed."

### 0:35–1:00 — A proposal that passes, and my approval
**Do:** *"OK, buy 1 share instead."* → open the approval link → **Approve**.
**Show:** the approval page (PAPER badge, proposed by claude.ai, live SnapTrade price, every check passed, expiry) → "Filled (simulated)".
**Say:** "The link does nothing on its own. When I approve, the whole policy runs again with a fresh SnapTrade quote, then it fills in paper mode."

### 1:00–1:10 — Claude sees the result
**Do:** *"What's the status of that order?"* → **FILLED**.

### 1:10–1:22 — Kill switch and audit log
**Do:** Dashboard → **Turn the kill switch on** (red bar) → open **Audit log**.
**Say:** "One click stops everything. And every step, who proposed it, every check, my approval, is in an audit log the database won't let anyone edit."

### 1:22–1:30 — Try it yourself
**Show:** the home page's **"Try the demo"** button.
**Say:** "No account needed: the demo gets you to a filled order in under two minutes. Link below."

---

**Turn the kill switch back off after recording.**
