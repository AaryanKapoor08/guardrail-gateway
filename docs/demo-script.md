# Demo video script (about 85 seconds), click by click

Three beats: **the problem and our answer (20 s) → the site (30 s) → Claude researches and trades (30 s)**, then a 5-second close.
Part 1 is a plain-English primer, Part 2 is the setup, Part 3 is the shot list: what to **click**, what you'll **see**, and what to **say**.

Every line below is true and checkable. The people watching are SnapTrade engineers who will click through the site, so we sound bold without claiming anything the product doesn't do.

---

## Part 1 — The project in plain English (2 minutes to read)

**The problem.** AI assistants like Claude can now be connected to your brokerage account (the company that holds your investments). If the AI can place trades by itself, one misunderstanding could spend your money. Telling it "don't spend more than $250" in a chat is only a suggestion; the AI could still get it wrong.

**What Guardrail Gateway does.** It sits between the AI and your brokerage. The AI is only allowed to **propose** a trade. Our server checks the proposal against **your rules**, and then **you** have to click **Approve** on our website. The AI has no way to approve anything itself.

| Word | What it means |
|---|---|
| **SnapTrade** | The company whose service connects apps to brokerages. You sign in with your SnapTrade account; it gives us access to your accounts. |
| **Sandbox** | A fake brokerage SnapTrade provides for testing. Its accounts ("Individual", "IRA") hold fake stocks like AAPL (Apple). No real money. |
| **Allowed account** | An account you've said the AI may see. Everything starts "Not allowed". You allowed only the Sandbox "Individual" account. |
| **Policy** | Your rules: biggest single order ($250), most you can spend per day ($600), buys only, and so on. 16 checks in total. |
| **Proposal / order** | The AI asking "can I buy X?". It's stored and checked; nothing is bought yet. |
| **Rejected** | The proposal broke a rule. The AI is told exactly which rule and why. |
| **Waiting for approval** | The proposal passed every rule; now it needs your click. |
| **Approve** | Your click on our site. We check all the rules again with a fresh price, then the order "fills". |
| **Paper mode / filled (simulated)** | Pretend trading: we record the purchase in our own ledger at the real price, but no real order goes to a broker. |
| **Kill switch** | One button that cancels everything waiting and blocks every new proposal. |
| **Audit log** | A list of every step: who did what, when. Nobody can edit or delete it. |
| **MCP / OAuth** | MCP is the open standard AI assistants use to plug into tools. OAuth is the "Allow this app?" sign-in, so Claude never sees a password. |

---

## Part 2 — Set up before recording (10 minutes)

1. Open **https://guardrail-gateway-xbqm.onrender.com** in Chrome. Wait up to ~30 s the first time (the free server wakes up). Click **Dashboard** so everything is warm.
2. Top bar should show **Paper mode · Dashboard · Orders · Policy · Audit log · AI apps · Sign out**. If it shows **Sign in**: **Sign in with SnapTrade** → finish signing in.
3. **Dashboard:** the tiles at the top should read **Mode: Paper**, **Kill switch: Off**, **Allowed accounts: 1 of …**, **Waiting for you: 0**. If the kill switch is on, click **Turn the kill switch off**.
4. **Policy:** Per-order limit **250**, Daily limit **600**, Currency **USD**. If not, set them and click **Save policy**.
5. **Orders:** if anything says "Waiting for your approval", open it and click **Deny**.
6. **claude.ai:** Settings → Connectors → **Guardrail Gateway** → set its tools to **Always allow**. Otherwise Claude stops to ask "Allow tool?" several times and eats your 30 seconds.
7. **Stage the rejection (off camera).** In a claude.ai chat with Guardrail Gateway on, send: **Buy 5 shares of AAPL in my Individual account**. Claude should say it was **rejected by your policy** (about $900 is over the $250 limit). This puts a blocked order on the Orders page for Shot 2.
8. Open a **fresh** claude.ai chat (Guardrail Gateway on) and paste the Shot 3 prompt into the box **without sending it**.
9. Back on our site: click **Guardrail Gateway** (top left) → home page → scroll to the top.
10. Zoom to 110–125 % (**Ctrl +**). Close other tabs. Hide the bookmarks bar (**Ctrl+Shift+B**).
11. Record with **Loom** (screen + microphone). Do one practice run first.

**Never show:** the `.env` file, any tokens, or real (non-Sandbox) account numbers on the Dashboard. If a real account row is visible, blur it in Loom's editor.

---

## Part 3 — The shot list

### Shot 1 · 0:00–0:20 · The problem and our answer · Home page

- **Click:** nothing at first, then scroll down slowly once through the four cards ("The AI proposes. You decide.").
- **Say (about 50 words):**
  > "AI agents can now trade in real brokerage accounts through SnapTrade. But telling an AI 'never spend more than $250' is a *suggestion*. Guardrail Gateway makes it a *guarantee*. The AI can only **propose** trades, my rules are enforced on the server, and nothing executes until I approve it."

### Shot 2 · 0:20–0:50 · The site, about 5 seconds per page

| Click (top bar) | You'll see | Say |
|---|---|---|
| **Dashboard** | Tiles: Mode Paper · Kill switch Off · Allowed accounts 1 of … · Waiting for you 0. Move the mouse over the Sandbox **Individual** row: **Allowed**. | "I sign in with SnapTrade. Paper mode, kill switch off, and the AI only sees the one account I allowed." |
| **Policy** | Cards: Spending limits (250 / 600), What the AI may do, Which stocks, and the green-ticked rules marked **Always on**. | "My rules: sixteen checks, enforced on the server. The AI can read them, never change them." |
| **Orders** | The staged 5-share AAPL order, **Rejected**. | "Every proposal is recorded. This one, nine hundred dollars of Apple, was blocked before it ever reached the broker." |
| **Audit log** | Table, newest first: the rejection, with time and details. | "Every step lands in an audit log nobody can edit." |
| **AI apps** | Claude listed, with a **Disconnect** button. | "Claude connects over MCP with OAuth, and I can cut it off in one click." |

### Shot 3 · 0:50–1:20 · Claude researches and trades

- **Click:** switch to the fresh **claude.ai** chat; the prompt is already pasted. Press Enter:
  > **Research how Apple's stock is doing this week, look at my Individual account and my trading rules, then buy as many whole shares of AAPL as my rules allow.**
- **You'll see:** Claude searches the web, then uses Guardrail Gateway (positions, policy, propose order). It says the order for **1 share** passed your policy and is **waiting for you**, with a link `…onrender.com/approvals/…`.
- **Click:** the link → **Review order** page: "Buy 1 AAPL", estimated value, **PAPER** badge, **Policy checks: 16 of 16 rules passed** → click **Approve**.
- **You'll see:** **Outcome: Filled. 1 at $… USD (simulated).**
- **Say:**
  > "Claude researches Apple, reads my holdings and my rules through our tools, and sizes the order to fit. But it can't approve its own trade. Only I can. When I approve, every rule runs again against a fresh SnapTrade price before it fills. Paper mode by default, so no real money moves."
- **Edit:** speed up Claude's thinking 3–4× in Loom/CapCut; live it takes a minute or more.

### Shot 4 · 1:20–1:25 · Close

- **Click:** **Guardrail Gateway** (top left) → home page.
- **Say:**
  > "SnapTrade gives AI access to brokerages. Guardrail Gateway makes that access safe to ship."
- **Stop recording.**

### After recording

- Make sure the kill switch is **off** (so reviewers don't find it on).
- Upload to YouTube as **Unlisted**; put the site link in the description: https://guardrail-gateway-xbqm.onrender.com

---

## If something goes off-script

| What happens | What to do |
|---|---|
| Claude words its answer differently | Fine. The point is "researched → proposed within my rules → waiting for me". |
| Claude proposes 0 shares or a fraction | Reply **"Buy 1 whole share of AAPL in my Individual account"** and cut the first answer in editing. |
| Claude stops to ask "Allow tool?" | Click **Always allow**, and fix it in Settings → Connectors before the next take. |
| Claude says it needs to reconnect | claude.ai → Settings → Connectors → Guardrail Gateway → Connect → **Allow** on our page. Restart the take. |
| The 1-share order is rejected for the **daily limit** | Today's $600 is used up by earlier tests. **Policy** → Daily limit **2000** → **Save policy**, retry. (Then say "my daily limit" without a number.) |
| "AAPL trades in USD, but your limits are in CAD" | **Policy** → Currency **USD** → **Save policy**. |
| The site is slow / blank | Wait 30–60 seconds and reload; the free server was asleep. |
| You fluff a line | Pause, say it again, trim later. Record the site part and the Claude part as separate takes if that's easier, or record silently and add the voiceover afterwards. |
