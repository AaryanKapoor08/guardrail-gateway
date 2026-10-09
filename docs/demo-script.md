# Demo video script (about 90 seconds)

**Problem and answer (20 s) → the site (30 s) → Claude, both prompts live (40 s) → close (5 s).**
The setup checklist is at the end.

---

## 1 · Home page · 0:00–0:20

*Scroll slowly through the four cards while you talk.*

> "AI assistants can now trade in real investment accounts through SnapTrade, but if you tell an AI to never spend more than 250 dollars, nothing actually stops it from getting that wrong. Guardrail Gateway fixes that, because the AI can only ask to make a trade, my own rules check every request, and nothing gets bought until I say yes."

---

## 2 · The site · 0:20–0:50

*Click each page in the top bar, then say its line.*

**Dashboard**
> "I sign in with my SnapTrade account, and here I can see I'm in practice mode, my emergency stop is off, and Claude can only see the one account I've allowed."

**Policy**
> "These are my rules, like a 250 dollar limit per order and 600 dollars a day, and Claude can read them but it can never change them."

**Orders**
> "Every order Claude asks for shows up here, along with whether my rules allowed it or blocked it."

**Audit log**
> "And every step gets written to a history that nobody can edit or delete."

**AI apps**
> "This is where Claude is connected, and I can disconnect it with one click."

---

## 3 · Claude · 0:50–1:30

**Step 1: switch to claude.ai and paste Prompt 1 into the box (don't send yet):**

```
Buy 5 shares of AAPL in my Individual account
```

**While pasting, say:**
> "I'm going to give Claude two requests, first a trade that's too big for my rules, and then a research request where it has to stay inside them."

**Step 2: press Enter. When Claude says it was rejected, say:**
> "That's about 900 dollars, way over my 250 dollar limit, so my site blocked it and told Claude exactly why."

**Step 3: paste Prompt 2 into the same chat and press Enter:**

```
Research how Apple's stock is doing this week, look at my Individual account and my trading rules, then buy as many whole shares of AAPL as my rules allow.
```

*Say nothing while Claude works; this part gets sped up in editing.*

**Step 4: when Claude says the order is waiting for you, say:**
> "This time Claude looked up Apple, checked my account and my rules, and asked for one share, but it still can't buy anything until I say yes."

**Step 5: click the link Claude gives you, then click Approve, and say:**
> "When I approve, my site checks every rule again with the latest price, and it buys in practice mode, so no real money is spent."

---

## 4 · Close · 1:30–1:35

*Click Guardrail Gateway (top left) to go back to the home page.*

> "SnapTrade lets AI reach your brokerage, and Guardrail Gateway makes sure you're always the one in control."

---

## Setup before recording

1. Open https://guardrail-gateway-xbqm.onrender.com and wait until it loads (up to 30 seconds while the free server wakes up).
2. **Dashboard:** the tiles say Paper, Kill switch Off, and Waiting for you 0.
3. **Policy:** Per-order limit 250, Daily limit 600, Currency USD. If anything is different, fix it and click Save policy.
4. **Orders:** deny anything that is still waiting.
5. **claude.ai:** go to Settings → Connectors → Guardrail Gateway and set the tools to **Always allow**, then open a new chat with Guardrail Gateway switched on.
6. Go back to our home page, zoom to 110–125 %, close other tabs, and record with Loom.

Never show the `.env` file, tokens, or real (non-Sandbox) account numbers.

**If Claude asks for a fraction of a share or 0 shares:** reply "Buy 1 whole share of AAPL in my Individual account" and cut the first answer out.
**If the order hits the daily limit:** on Policy, set the Daily limit to 2000 and save.
**After recording:** check the kill switch is off.

---

## The two Claude prompts (both live, in the same chat)

**Prompt 1: too big, gets blocked**

```
Buy 5 shares of AAPL in my Individual account
```

**Prompt 2: research, then a trade that fits my rules**

```
Research how Apple's stock is doing this week, look at my Individual account and my trading rules, then buy as many whole shares of AAPL as my rules allow.
```
