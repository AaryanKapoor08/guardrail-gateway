# Demo video script (90 seconds), click by click

Read Part 1 once so you understand what you're showing. Part 2 is the setup. Part 3 is the shot list: what to **click**, what you'll **see**, and what to **say** (or put as a caption).

---

## Part 1 — The project in plain English (2 minutes to read)

**The problem.** AI assistants like Claude can now be connected to your brokerage account (the company that holds your investments). If the AI can place trades by itself, one misunderstanding could spend your money. Telling it "don't spend more than $100" in a chat is only a suggestion; the AI could still get it wrong.

**What Guardrail Gateway does.** It sits between the AI and your brokerage. The AI is only allowed to **propose** a trade. Our server checks the proposal against **your rules**, and then **you** have to click **Approve** on our website. The AI has no way to approve anything itself.

**The words you'll see:**

| Word | What it means |
|---|---|
| **SnapTrade** | The company whose service connects apps to brokerages. You sign in with your SnapTrade account; it gives us read access to your accounts. |
| **Sandbox** | A fake brokerage SnapTrade provides for testing. Its accounts ("Individual", "IRA") hold fake stocks like AAPL (Apple). No real money. |
| **Allowed account** | An account you've said the AI may see. Everything starts "Not allowed". You allowed only the Sandbox "Individual" account. |
| **Policy** | Your rules: biggest single order ($250), most you can spend per day ($600), buys only, and so on. 16 checks in total. |
| **Proposal / order** | The AI asking "can I buy X?". It's stored and checked; nothing is bought yet. |
| **Rejected** | The proposal broke a rule. The AI is told exactly which rule and why. |
| **Waiting for approval** | The proposal passed every rule; now it needs your click. |
| **Approve** | Your click on our site. We check all the rules again with a fresh price, then the order "fills". |
| **Paper mode / filled (simulated)** | "Paper trading" means pretend trading: we record the purchase in our own ledger at the real price, but no real order goes to a broker. |
| **Kill switch** | One button that cancels everything waiting and blocks every new proposal. |
| **Audit log** | A list of every step: who did what, when. Nobody can edit or delete it. |
| **Connector (MCP)** | How Claude is plugged into our site. Claude signed in to us once; now it can use our tools (list accounts, propose an order, check status). |

**The one-sentence pitch:** "AI can already reach your brokerage. Guardrail Gateway makes sure it can only *ask*, and that you're the one who says yes."

---

## Part 2 — Set up before recording (10 minutes)

1. Open **https://guardrail-gateway-xbqm.onrender.com** in Chrome. Wait for it to load (up to ~30 seconds the first time; the free server wakes up). Click **Dashboard** once so everything is warm.
2. Check the top bar shows **Paper mode · Dashboard · Orders · Policy · Audit log · AI apps · Sign out**. If it shows **Sign in** instead: click it → **Sign in with SnapTrade** → finish signing in.
3. On the **Dashboard**, scroll down and check the card says **Kill switch: off**. If it says ON, click **Turn the kill switch off**.
4. Click **Policy** in the top bar. Check: Per-order limit **250**, Daily limit **600**, Currency **USD**. (If not, set them and click **Save policy**.)
5. Click **Orders**. If anything says "Waiting for your approval", open it and click **Deny**, so you start clean.
6. Open a second tab: **claude.ai** → **New chat**. Click the tools/connectors button (the slider icon by the message box) and make sure **Guardrail Gateway** is switched on.
7. Go back to the Guardrail tab, click **Guardrail Gateway** (top left) to land on the **home page**, and scroll to the very top.
8. Zoom: press **Ctrl +** once or twice (110–125 %) so text is readable in the video. Close other tabs. Hide the bookmarks bar (**Ctrl+Shift+B**).
9. Start recording with **Loom** (screen + microphone; no camera needed). Do one practice run first.

**Never show:** the `.env` file, any tokens, or the Wealthsimple account numbers up close (they're on the Dashboard; don't zoom into that row).

---

## Part 3 — The shot list

### Shot 1 · 0:00–0:10 · Home page

- **Click:** nothing at first. Then scroll down slowly once so the four cards ("The AI proposes. You decide.") come into view.
- **You'll see:** the big "Guardrail Gateway" title, then four cards (Claude asking, rule checks, Approve button, audit log).
- **Say:** "AI assistants can now connect to brokerage accounts through SnapTrade. Guardrail Gateway makes sure the AI can only *propose* trades. My rules check them, and nothing happens until I approve."

### Shot 2 · 0:10–0:20 · Dashboard and Policy

- **Click:** **Dashboard** (top bar).
- **You'll see:** the **Accounts** table. Point (move your mouse) at the Sandbox **Individual** row: it says **Allowed**. The others say **Not allowed**.
- **Say:** "I signed in with SnapTrade. The AI only sees accounts I allow; here, just this Sandbox account."
- **Click:** **Policy** (top bar).
- **You'll see:** Per-order limit 250, Daily limit 600.
- **Say:** "These are my rules: at most $250 an order and $600 a day. The AI can read them, but it can't change them."

### Shot 3 · 0:20–0:35 · Claude asks for too much

- **Click:** switch to the **claude.ai** tab. Type exactly: **Buy 5 shares of AAPL in my Individual account** → press Enter.
- **You'll see:** Claude uses "Guardrail Gateway" and answers that the order was **rejected by your policy**: about $902.50 is over the $250 per-order limit (and the daily limit).
- **Say:** "I ask Claude to buy 5 Apple shares. Our server checks every rule and rejects it, and Claude gets the exact reasons. Nothing was bought."

### Shot 4 · 0:35–1:00 · A small order, and my approval

- **Click:** in Claude type: **OK, buy 1 share instead** → Enter.
- **You'll see:** Claude says the order passed your policy and is **waiting for you**, with a link `…onrender.com/approvals/…`.
- **Say:** "One share passes every rule, but it still waits for me."
- **Click:** the link Claude gave (it opens our site).
- **You'll see:** the **Review order** page: "Buy 1 AAPL", the estimated value (~$180.50 USD), a **PAPER** badge, **Your decision** with **Approve / Deny**, and **Policy checks: 16 of 16 rules passed** with green ticks.
- **Say:** "Opening this link does nothing on its own. Here's exactly what the AI proposed, and every rule it passed."
- **Click:** **Approve**.
- **You'll see:** the page now shows **Outcome: Filled. 1 at $180.50 USD (simulated).**
- **Say:** "When I approve, every rule runs again with a fresh price from SnapTrade, then it fills, in paper mode, so no real money moves."

### Shot 5 · 1:00–1:10 · Claude sees the result

- **Click:** back to the **claude.ai** tab. Type: **What's the status of that order?** → Enter.
- **You'll see:** Claude says it's **filled**: 1 share of AAPL at $180.50 (simulated).
- **Say:** "Claude can check the result, but only I could approve it."

### Shot 6 · 1:10–1:22 · Kill switch and audit log

- **Click:** back to our site → **Dashboard** → scroll down to the **Kill switch: off** card → click **Turn the kill switch on**.
- **You'll see:** a **red bar** under the navbar: "Kill switch is ON: every order the AI proposes is refused."
- **Say:** "One click and the AI can't propose anything."
- **Click:** **Audit log** (top bar).
- **You'll see:** a table, newest first: the kill switch, the fill, your approval, Claude's proposals ("ai (claude.ai)"), each with time and details.
- **Say:** "And every step, from who proposed to every check and my approval, is in a log nobody can edit."

### Shot 7 · 1:22–1:30 · Close

- **Click:** **Guardrail Gateway** (top left) → the home page.
- **Say:** "You can try it yourself with no sign-up. Hit 'Try the demo'. Link in the description."
- **Stop recording.**

### After recording

- **Dashboard → Turn the kill switch off** (so reviewers don't find it on).
- Upload to YouTube as **Unlisted**; put the site link in the description: https://guardrail-gateway-xbqm.onrender.com

---

## If something goes off-script

| What happens | What to do |
|---|---|
| Claude words its answer differently | Fine. Keep talking; the point is "rejected with reasons" / "waiting for approval". |
| Claude says it needs to reconnect | claude.ai → Settings → Connectors → Guardrail Gateway → Connect → **Allow** on our page. Restart the recording. |
| The 1-share order is rejected for the **daily limit** | Today's $600 is used up by earlier tests. **Policy** → Daily limit **2000** → **Save policy**, then retry. |
| "AAPL trades in USD, but your limits are in CAD" | **Policy** → Currency **USD** → **Save policy**. |
| The site is slow / blank | Wait 30–60 seconds and reload; the free server was asleep. |
| You mess up a line | Just pause and say it again; trim it later, or re-record. 2–3 takes is normal. |

**Optional extra (only if you have spare seconds):** in Claude, ask *"Look at my Individual account. What do I hold and how concentrated is it?"* It shows the AI can analyse your account through our read-only tools, while still being unable to trade on its own.
