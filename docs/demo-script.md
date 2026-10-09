# Demo video script (about 85 seconds)

**Problem and answer (20 s) → the site (30 s) → Claude researches and trades (30 s) → close (5 s).**
The setup checklist and the two Claude prompts are at the end.

---

## 1 · Home page · 0:00–0:20

*Scroll slowly through the four cards while you talk.*

> "AI agents can now trade in real brokerage accounts through SnapTrade, but telling an AI to never spend more than 250 dollars is just a suggestion. Guardrail Gateway turns that into a guarantee, because the AI can only propose trades, my rules are enforced on the server, and nothing happens until I approve it."

---

## 2 · The site · 0:20–0:50

*Click each page in the top bar, then say its line.*

**Dashboard**
> "I sign in with SnapTrade, I'm in paper mode with the kill switch off, and the AI can only see the one account I've allowed."

**Policy**
> "These are my rules, sixteen checks enforced on the server, and the AI can read them but it can never change them."

**Orders**
> "Every proposal gets recorded, and this one, nine hundred dollars of Apple, was blocked before it ever reached the broker."

**Audit log**
> "Every single step lands in an audit log that nobody can edit."

**AI apps**
> "Claude connects through MCP with OAuth, and I can cut it off with one click."

---

## 3 · Claude · 0:50–1:20

*Switch to claude.ai. Prompt 2 is already pasted in the box.*

**As you press Enter** (normal speed)
> "Now I'll ask Claude to research Apple and buy as much as my rules allow."

**While Claude works** (sped up 3× in editing, stay silent)

**When Claude says the order is waiting for you** (normal speed)
> "Claude read my holdings and my rules through our tools and sized the order to fit, but it can't approve its own trade, only I can."

**Click the approval link, then click Approve**
> "When I approve, every rule runs again against a fresh SnapTrade price, and it fills in paper mode so no real money moves."

---

## 4 · Close · 1:20–1:25

*Click Guardrail Gateway (top left) to go back to the home page.*

> "SnapTrade gives AI access to brokerages, and Guardrail Gateway makes that access safe to ship."

---

## Setup before recording

1. Open https://guardrail-gateway-xbqm.onrender.com and wait until it loads (up to 30 seconds while the free server wakes up).
2. **Dashboard:** the tiles say Paper, Kill switch Off, and Waiting for you 0.
3. **Policy:** Per-order limit 250, Daily limit 600, Currency USD. If anything is different, fix it and click Save policy.
4. **Orders:** deny anything that is still waiting.
5. **claude.ai:** go to Settings → Connectors → Guardrail Gateway and set the tools to **Always allow**.
6. Send **Prompt 1** in a claude.ai chat, so a rejected order shows up on the Orders page.
7. Open a **new** claude.ai chat and paste **Prompt 2** without sending it.
8. Go back to our home page, zoom to 110–125 %, close other tabs, and record with Loom.

Never show the `.env` file, tokens, or real (non-Sandbox) account numbers.

**If Claude proposes a fraction or 0 shares:** reply "Buy 1 whole share of AAPL in my Individual account" and cut the first answer out.
**If the order hits the daily limit:** on Policy, set the Daily limit to 2000 and save.
**After recording:** check the kill switch is off.

---

## The two Claude prompts

**Prompt 1: before recording, off camera** (this creates the blocked order you show on the Orders page)

```
Buy 5 shares of AAPL in my Individual account
```

**Prompt 2: on camera, in a new chat**

```
Research how Apple's stock is doing this week, look at my Individual account and my trading rules, then buy as many whole shares of AAPL as my rules allow.
```
