import type { SignedIn } from '../../auth/sessions.js';
import { SignInChoices } from '../../demo/pages.js';
import { Layout } from '../layout.js';

// The landing page. The bento cards are illustrations of the real flow (same wording the app
// and Claude actually show), not live data.

function StartButtons(props: { signedIn: SignedIn | undefined }) {
  return props.signedIn === undefined ? (
    <SignInChoices />
  ) : (
    <div class="choices">
      <a href="/dashboard" class="button big">
        Go to your dashboard
      </a>
    </div>
  );
}

function Hero(props: { signedIn: SignedIn | undefined }) {
  return (
    <div class="hero">
      <p class="eyebrow">Built on SnapTrade · Works with Claude</p>
      <h1>Guardrail Gateway</h1>
      <p class="tagline">
        Let an AI assistant propose trades, inside rules you set. Nothing happens until you click
        Approve.
      </p>
      <StartButtons signedIn={props.signedIn} />
      <p class="facts">
        <span class="dot ok" />
        Paper trading by default · 16 policy checks on every order · Every step in an audit log
      </p>
    </div>
  );
}

function ProposeCard() {
  return (
    <div class="card wide">
      <div class="inner chat">
        <div class="bubble me">Buy 5 shares of AAPL in my Individual account</div>
        <div class="bubble ai">
          Rejected by your policy: $902.50 is over your $250 per-order limit and your $600 daily
          limit. Want me to propose 1 share instead?
        </div>
      </div>
      <div>
        <p class="label">1 · The AI proposes</p>
        <h3>Claude asks. It never acts.</h3>
        <p class="desc">
          Claude connects through MCP and can read only the accounts you allow. It has no tool to
          approve an order, change a limit, or turn off the kill switch.
        </p>
      </div>
    </div>
  );
}

function RulesCard() {
  return (
    <div class="card">
      <div class="rows">
        <div class="row">
          Account allowed <span class="pill ok">Pass</span>
        </div>
        <div class="row">
          Buys only <span class="pill ok">Pass</span>
        </div>
        <div class="row">
          Per-order limit <span class="pill bad">Fail</span>
        </div>
        <div class="row">
          Daily limit <span class="pill bad">Fail</span>
        </div>
      </div>
      <div>
        <p class="label">2 · Your rules check it</p>
        <h3>16 checks, every reason</h3>
        <p class="desc">
          A pure policy engine runs every rule against a fresh SnapTrade quote and your holdings.
        </p>
      </div>
    </div>
  );
}

function ApproveCard() {
  return (
    <div class="card">
      <div class="inner">
        <p class="label">Buy 1 AAPL · Individual ••••-001</p>
        <p class="stat">
          $180.50 <small>USD</small>
        </p>
        <div class="mock-actions">
          <span class="yes">Approve</span>
          <span class="no">Deny</span>
        </div>
      </div>
      <div>
        <p class="label">3 · You approve</p>
        <h3>Your click, on our site</h3>
        <p class="desc">
          Opening the link does nothing. Approving reruns every rule with a fresh price, then fills
          in paper mode.
        </p>
      </div>
    </div>
  );
}

function AuditCard() {
  return (
    <div class="card wide">
      <div class="rows">
        <div class="row">
          <span>
            <span class="dot" />
            ai (claude.ai) proposed BUY 1 AAPL
          </span>
          <span class="meta">3:09 AM</span>
        </div>
        <div class="row">
          <span>
            <span class="dot ok" />
            Policy passed, waiting for approval
          </span>
          <span class="meta">3:09 AM</span>
        </div>
        <div class="row">
          <span>
            <span class="dot ok" />
            user approved · filled 1 at $180.50 (paper)
          </span>
          <span class="meta">3:10 AM</span>
        </div>
      </div>
      <div>
        <p class="label">4 · Everything is recorded</p>
        <h3>An audit log no one can edit</h3>
        <p class="desc">
          Every proposal, check, approval, and fill is written in the same database transaction as
          the change. The database itself refuses to update or delete these rows.
        </p>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <>
      <div class="section-head">
        <p class="eyebrow">How it works</p>
        <h2>The AI proposes. You decide.</h2>
        <p>
          Telling a model "don't spend more than $100" is a suggestion. Guardrail Gateway makes it a
          rule, enforced on a server the AI can't touch.
        </p>
      </div>
      <div class="bento">
        <ProposeCard />
        <RulesCard />
        <ApproveCard />
        <AuditCard />
      </div>
    </>
  );
}

function CantCard(props: { title: string; text: string }) {
  return (
    <div class="card">
      <div class="x">✕</div>
      <h3>{props.title}</h3>
      <p class="desc">{props.text}</p>
    </div>
  );
}

function WhatTheAiCantDo() {
  return (
    <>
      <div class="section-head">
        <p class="eyebrow">Safe by design</p>
        <h2>What the AI can't do.</h2>
      </div>
      <div class="cant">
        <CantCard
          title="Approve its own orders"
          text="Approval needs your signed-in session and a signed form on this website."
        />
        <CantCard
          title="Change your limits"
          text="Your policy is read-only to the AI. Every change you make is versioned and audited."
        />
        <CantCard
          title="Turn off the kill switch"
          text="One click cancels everything waiting and refuses every new order until you say so."
        />
      </div>
    </>
  );
}

export function HomePage(props: { signedIn: SignedIn | undefined }) {
  return (
    <Layout title="Home" signedIn={props.signedIn}>
      <Hero signedIn={props.signedIn} />
      <HowItWorks />
      <WhatTheAiCantDo />
      <div class="cta">
        <h2>Try it in under two minutes.</h2>
        <p class="notice">
          The demo uses clearly labelled fake brokerage data and needs no account. Sign in with
          SnapTrade to use your own connected accounts.
        </p>
        <StartButtons signedIn={props.signedIn} />
      </div>
    </Layout>
  );
}
