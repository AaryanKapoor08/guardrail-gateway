# Demo video script (about 1:45)

**Problem and solution (25 s) → the site (30 s) → Claude, both prompts live (45 s) → close (5 s).**
The setup checklist is at the end.

---

## 1 · Home page · 0:00–0:25

*Start on the hero ("AI can propose the trade. Only you can approve it."), then scroll slowly down to "How it works" while you talk.*

**The problem (one line):**
> "AI agents can now trade real brokerage accounts through SnapTrade, and nothing stops a confident AI from being confidently wrong with your money."

**The solution (three lines):**
> "Guardrail Gateway connects to Claude over MCP with OAuth, so the AI can only propose a trade, it can never place one or approve one.
> Every proposal runs through sixteen rules on our server, priced with SnapTrade's live quote, and our Claim Check fact-checks the AI's own reasoning, the price it expects and the company it thinks it's buying, against what the broker actually says.
> Nothing executes until I approve it on our site, every rule runs again at that moment, and every step is written to an audit log nobody can edit."

---

## 2 · The site · 0:25–0:55

*Click each page in the left sidebar, then say its line.*

**Dashboard**
> "I sign in with my SnapTrade account, and here I can see I'm in practice mode, my emergency stop is off, and Claude can only see the one account I've allowed."

**Policy**
> "These are my rules, like a 500 dollar limit per order and 2,000 dollars a day, and Claude can read them but it can never change them."

**Orders**
> "Every order Claude asks for shows up here, along with whether my rules allowed it or blocked it."

**Audit log**
> "And every step gets written to a history that nobody can edit or delete."

**AI apps**
> "This is where Claude is connected, and I can disconnect it with one click."

---

## 3 · Claude · 0:55–1:40

**Step 1: switch to claude.ai and paste Prompt 1 into the box (don't send yet):**

```
Send an order through Guardrail Gateway to buy 5 shares of AAPL in my Individual account. Don't decide yourself whether it breaks my rules, let Guardrail Gateway check it.
```

**While pasting, say:**
> "I'm going to give Claude two requests, first a trade that's too big for my rules, and then a research request where Claude has to show its reasoning."

**Step 2: press Enter. When Claude says it was rejected, say:**
> "Claude tried, but five shares is way over my 500 dollar limit, so my site blocked it and told Claude exactly which rule it broke."

**Step 3: paste Prompt 2 into the same chat and press Enter:**

```
Research how Apple's stock is doing this week and look at my Individual account, then send an order through Guardrail Gateway to buy 1 share of AAPL.
```

*Say nothing while Claude works; this part gets sped up in editing.*

**Step 4: when Claude says the order is waiting for you (it should also mention the price difference), say:**
> "Claude researched Apple and asked for one share, and our Claim Check already caught that Claude's research and my broker disagree on the price by almost half."

**Step 5: click the link Claude gives you. On the approval page, point at the red banner, then scroll slowly over the "What the AI believes vs what your broker says" card (red ✕ on the price, green ✓ on the company), and say:**
> "Instead of making me read sixteen green ticks, the page puts the one thing that's wrong right at the top, so I'm checking the AI's reasoning, not just rubber-stamping it."

**Step 6: scroll down to Approve, click it, and say:**
> "The broker's price is what I'd actually pay and it fits my rules, so I approve, every rule runs again with the latest price, and it fills in practice mode, so no real money is spent."

---

## 4 · Close · 1:40–1:45

*Click the Guardrail Gateway logo (top left) to go back to the home page.*

> "SnapTrade lets AI reach your brokerage, and Guardrail Gateway makes sure you're always the one in control."

---

## Setup before recording

1. Open https://guardrail-gateway-xbqm.onrender.com and wait until it loads (up to 30 seconds while the free server wakes up).
2. **Dashboard:** the tiles say Paper, Kill switch Off, and Waiting for you 0.
3. **Policy:** Per-order limit **500**, Daily limit **2000**, Currency USD, and **Orders per day** 20 so practice runs don't use up the day (the Sandbox prices AAPL at about $180.50, so 1 share passes and 5 shares, about $902, are blocked). If anything is different, fix it and click Save policy.
4. **Orders:** deny anything that is still waiting.
5. **claude.ai, refresh the connector (needed once after the Claim Check update):** Settings → Connectors → Guardrail Gateway → **Disconnect**, then **Connect** and click **Allow** on our page. This makes Claude load the new version of our tools.
6. **claude.ai:** in the same Connectors screen, set the Guardrail Gateway tools to **Always allow**, then open a new chat with Guardrail Gateway switched on.
7. Go back to our home page, zoom to 110–125 %, close other tabs, and record with Loom.

Never show the `.env` file, tokens, or real (non-Sandbox) account numbers.

**If Claude refuses to send an order itself** (it says "I didn't place this order" without using Guardrail Gateway): reply "Send it anyway, let Guardrail Gateway decide" and cut the first answer out.
**If there's no red banner on the approval page** (Claude didn't give its expected price): skip the Step 4 and Step 5 lines about the difference and just say the Step 6 line.
**If Claude shows an error about the tool's output:** the connector is still on the old version; redo setup step 5.
**After recording:** check the kill switch is off.
