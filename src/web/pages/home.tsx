import type { Child } from 'hono/jsx';
import type { SignedIn } from '../../auth/sessions.js';
import { SignInChoices } from '../../demo/pages.js';
import { LockIcon, PowerIcon, ShieldIcon } from '../components/icons.js';
import { Layout } from '../layout.js';

// The landing page. The order-flow card and audit rows are illustrations of the real flow (the
// same wording the app shows), not live data.

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

function Eyebrow(props: { children: Child }) {
  return <p class="kicker">{props.children}</p>;
}

function FlowStep(props: {
  number: string;
  title: string;
  tone?: 'flag' | 'done';
  children: Child;
}) {
  const toneClass = props.tone === undefined ? '' : ` is-${props.tone}`;
  return (
    <li class={`flow-step${toneClass}`}>
      <span class="flow-marker">{props.number}</span>
      <div>
        <p class="flow-title">{props.title}</p>
        {props.children}
      </div>
    </li>
  );
}

// One order going through the gateway, lit up step by step by a CSS loop (no JavaScript).
function OrderFlowPreview() {
  return (
    <figure class="flow-card">
      <div class="flow-head">
        <span class="flow-live">
          <span class="flow-dot" />
          One order, start to finish
        </span>
        <span class="flow-badge">Paper</span>
      </div>
      <ol class="flow-steps">
        <FlowStep number="1" title="Claude proposes">
          <p class="flow-detail">"Buy 1 AAPL in my Individual account"</p>
        </FlowStep>
        <FlowStep number="2" title="Your rules check it">
          <div class="flow-bar">
            <span />
          </div>
          <p class="flow-detail">16 of 16 rules passed, priced with SnapTrade's quote</p>
        </FlowStep>
        <FlowStep number="3" title="Claim Check flags it" tone="flag">
          <p class="flow-detail">AI expected $330.00 · broker says $180.50</p>
        </FlowStep>
        <FlowStep number="4" title="You decide">
          <span class="flow-approve">Approve</span>
        </FlowStep>
        <FlowStep number="5" title="Filled" tone="done">
          <p class="flow-detail">1 AAPL at $180.50 · paper, no real money</p>
        </FlowStep>
      </ol>
      <figcaption>An illustration of the real flow, on a loop.</figcaption>
    </figure>
  );
}

function Hero(props: { signedIn: SignedIn | undefined }) {
  return (
    <section class="site-section hero-section">
      <div class="hero-copy">
        <Eyebrow>Built on SnapTrade · Works with Claude</Eyebrow>
        <h1 class="display">
          AI can propose the trade. <span class="accent">Only you can approve it.</span>
        </h1>
        <p class="hero-lead">
          AI agents can now trade real brokerage accounts, and a confident AI can be confidently
          wrong. Guardrail Gateway sits in between: the AI proposes, your rules and your broker's
          data check it, and nothing happens until you click Approve.
        </p>
        <StartButtons signedIn={props.signedIn} />
        <p class="hero-facts">
          16 server-side rules · Paper trading by default · Append-only audit log
        </p>
      </div>
      <OrderFlowPreview />
    </section>
  );
}

function Step(props: { number: string; title: string; children: Child }) {
  return (
    <li class="step">
      <span class="step-number">{props.number}</span>
      <h3>{props.title}</h3>
      <p>{props.children}</p>
    </li>
  );
}

function HowItWorks() {
  return (
    <section class="site-section" id="how-it-works">
      <div class="section-intro">
        <Eyebrow>How it works</Eyebrow>
        <h2 class="display-2">
          The AI proposes. <span class="accent">You decide.</span>
        </h2>
        <p>
          Telling a model "don't spend more than $100" is a suggestion. Here it is a rule, enforced
          on a server the AI can't touch.
        </p>
      </div>
      <ol class="step-row">
        <Step number="01" title="The AI proposes">
          It connects over MCP with OAuth, sees only the accounts you allow, and can only propose.
          There is no tool to approve, change a limit, or turn off the kill switch.
        </Step>
        <Step number="02" title="Your rules check it">
          16 rules run on our server, priced with SnapTrade's latest quote: limits per order and per
          day, allowed symbols and actions, stocks and ETFs only, no short selling.
        </Step>
        <Step number="03" title="Claim Check fact-checks it">
          The AI says what price and company it expects. We compare both with your broker's data and
          flag any difference on the approval page.
        </Step>
        <Step number="04" title="You approve">
          Opening the link does nothing. Approving re-runs every rule with a fresh price, then the
          order fills in paper mode.
        </Step>
      </ol>
    </section>
  );
}

function Limit(props: { icon: Child; title: string; children: Child }) {
  return (
    <li class="limit">
      <span class="limit-icon">{props.icon}</span>
      <h3>{props.title}</h3>
      <p>{props.children}</p>
    </li>
  );
}

function WhatTheAiCantDo() {
  return (
    <section class="site-section" id="safety">
      <div class="section-intro">
        <Eyebrow>Safe by design</Eyebrow>
        <h2 class="display-2">What the AI can't do.</h2>
      </div>
      <ul class="limit-row">
        <Limit icon={<ShieldIcon />} title="Approve its own orders">
          Approval needs your signed-in session and a signed form on this website.
        </Limit>
        <Limit icon={<LockIcon />} title="Change your limits">
          Your policy is read-only to the AI. Every change you make is versioned and audited.
        </Limit>
        <Limit icon={<PowerIcon />} title="Turn off the kill switch">
          One click cancels everything waiting and refuses every new order until you say so.
        </Limit>
      </ul>
    </section>
  );
}

function AuditPreview() {
  return (
    <ol class="audit-preview" aria-label="Example audit log">
      <li>
        <span class="audit-time">3:09 AM</span>
        <code>intent.proposed</code>
        <span>ai (claude.ai) proposed BUY 1 AAPL</span>
      </li>
      <li>
        <span class="audit-time">3:09 AM</span>
        <code>intent.pending_approval</code>
        <span>16 of 16 rules passed</span>
      </li>
      <li>
        <span class="audit-time">3:10 AM</span>
        <code>intent.approved</code>
        <span>user approved, rules re-run with a fresh price</span>
      </li>
      <li>
        <span class="audit-time">3:10 AM</span>
        <code>intent.filled</code>
        <span>filled 1 at $180.50 (paper)</span>
      </li>
    </ol>
  );
}

function AuditSection() {
  return (
    <section class="site-section split-section">
      <div class="section-intro left">
        <Eyebrow>On the record</Eyebrow>
        <h2 class="display-2">Every step, in a log no one can edit.</h2>
        <p>
          Each proposal, check, approval, and fill is written in the same database transaction as
          the change itself. The database refuses to update or delete those rows.
        </p>
      </div>
      <AuditPreview />
    </section>
  );
}

function CallToAction(props: { signedIn: SignedIn | undefined }) {
  return (
    <section class="site-section cta-band">
      <h2 class="display-2">Try it in under two minutes.</h2>
      <p>
        The demo uses clearly labelled fake brokerage data and needs no account. Sign in with
        SnapTrade to use your own connected accounts.
      </p>
      <StartButtons signedIn={props.signedIn} />
    </section>
  );
}

export function HomePage(props: { signedIn: SignedIn | undefined }) {
  return (
    <Layout title="Home" signedIn={props.signedIn} frame="site">
      <Hero signedIn={props.signedIn} />
      <HowItWorks />
      <WhatTheAiCantDo />
      <AuditSection />
      <CallToAction signedIn={props.signedIn} />
    </Layout>
  );
}
