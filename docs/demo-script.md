# Demo video script (2–3 minutes)

**Goal:** show that an AI can propose trades but can never act without passing the user's rules and the user's own click, and that every step is recorded.

**Set up before recording**
- Deployed site open in a browser, signed out. SnapTrade Personal test user ready, with the Sandbox brokerage connected.
- Claude (web) open in a second tab, with no Guardrail Gateway connector yet.
- Pick a cheap Sandbox ETF the account can buy (about $30, e.g. XEQT.TO) and an expensive one (e.g. VFV.TO).
- Default policy: buys only, $100 per order, $250 a day, approval within 10 minutes.
- Zoom the browser to 125% so text is readable.

---

### 0:00–0:15 — The problem
**Show:** the home page.
**Say:** "AI assistants can now talk to brokerage accounts. Telling a model in a prompt 'don't spend more than $100' is a suggestion. Guardrail Gateway makes it enforcement: the AI can only *propose* orders; my rules check them on a server it can't touch, and nothing happens until I click Approve."

### 0:15–0:35 — Sign in and choose what the AI may see
**Do:** Sign in with SnapTrade → the dashboard lists the Sandbox accounts, all "Not allowed" → click **Allow** on the TFSA.
**Say:** "Signing in uses SnapTrade's OAuth. No account is visible to the AI until I allow it. Account numbers are stored as the last four digits only."

### 0:35–0:50 — The policy
**Do:** Open **Policy**. Point at per-order $100, daily $250, buys only, the fixed rules.
**Say:** "These are my rules. The AI can read them but never change them, and every change is versioned in the audit log."

### 0:50–1:15 — Connect Claude
**Do:** Copy the connector URL from the dashboard → Claude: Settings → Connectors → Add custom connector → paste → the consent page opens → point at "claude.ai" and the redirect host → **Allow**.
**Say:** "Claude gets a token from *my* server, bound to this one endpoint. It never sees my SnapTrade token. The consent page names the real requesting site, not whatever name an app claims."

### 1:15–1:35 — A proposal that breaks the rules
**Do:** In Claude: *"Buy 4 shares of VFV.TO in my TFSA."*
**Show:** Claude's answer: rejected, with "Order value $609.60 CAD exceeds your per-order limit of $100.00 CAD" and the daily-limit reason.
**Say:** "Every rule runs, so the AI sees every problem at once, in plain English. Nothing was sent anywhere."

### 1:35–2:05 — A proposal that passes, and my approval
**Do:** In Claude: *"OK, buy 1 XEQT.TO instead."* → Claude shows the approval link → open it.
**Show:** the approval page: PAPER badge, "proposed by claude.ai", the account, the price source label, "Fees: None (simulated)", every check passed, the expiry time → click **Approve** → "Filled. 1 at $… (simulated)."
**Say:** "Opening the link does nothing by itself; approving needs my session and a signed form. At approval the whole policy runs again with a fresh price. Paper mode is the default: this fill is simulated in our own ledger."

### 2:05–2:20 — Claude sees the result
**Do:** In Claude: *"What's the status of that order?"* → **FILLED**.

### 2:20–2:35 — The kill switch
**Do:** Ask Claude for another small order (pending) → on the dashboard press **Turn the kill switch on** → the red bar appears; the pending order is cancelled → ask Claude to propose again → rejected by the kill switch.
**Say:** "One click cancels everything waiting and refuses everything new."

### 2:35–2:50 — The audit log
**Do:** Open **Audit log**.
**Show:** sign-in, account allowed, AI app approved, each proposal with actor "ai (claude.ai)", the checks, my approval, the fill, the kill switch.
**Say:** "Every step is recorded in the same database transaction as the change itself, and the database refuses to edit or delete these rows."

### 2:50–3:00 — Try it yourself
**Show:** the home page's **"Try the demo"** button.
**Say:** "No account needed: the demo runs the same code on clearly labelled fake data and gets you to a filled order in under two minutes."

---

**Never in the video:** real account numbers, the `.env` file, tokens, or the SnapTrade dashboard's API keys page.
