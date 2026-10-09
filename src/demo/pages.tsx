import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';
import type { PaperPosition } from '../executors/paper.js';
import type { IntentView } from '../intents/view.js';
import { fmtMoney } from '../lib/money.js';
import { statusLabel } from '../web/format.js';
import { Layout } from '../web/layout.js';
import { completedSteps, GUIDED_STEPS, type GuidedStep } from './guided-steps.js';

// The two equal ways in (V§4.7): an instant demo, or a real SnapTrade sign-in. Used on the home
// page and on the sign-in page Claude's connector opens.
export function SignInChoices(props: { mcpRequestId?: string | undefined }) {
  const loginHref =
    props.mcpRequestId === undefined ? '/login' : `/login?mcp_request=${props.mcpRequestId}`;
  return (
    <div class="choices">
      <form method="post" action="/demo/start" class="inline">
        {props.mcpRequestId === undefined ? null : (
          <input type="hidden" name="mcp_request" value={props.mcpRequestId} />
        )}
        <button type="submit" class="big">
          Try the demo (no sign-up, ~1 minute)
        </button>
      </form>{' '}
      <a href={loginHref} class="button secondary big">
        Sign in with SnapTrade
      </a>
    </div>
  );
}

export function SignInPage(props: { mcpRequestId: string | undefined }) {
  return (
    <Layout title="Sign in">
      <div class="page-head">
        <p class="eyebrow">Welcome</p>
        <h1>Sign in to Guardrail Gateway</h1>
      </div>
      <p class="lead">
        Use the demo to try everything with fake brokerage data and no account, or sign in with
        SnapTrade to use your own connected brokerage accounts.
      </p>
      <SignInChoices mcpRequestId={props.mcpRequestId} />
      <p class="notice">
        Either way, an AI app can only propose orders. Every order needs your approval on this
        website.
      </p>
    </Layout>
  );
}

function Checklist(props: { intents: readonly IntentView[] }) {
  const done = completedSteps(props.intents);
  const item = (isDone: boolean, text: string) => (
    <li class={isDone ? 'pass' : ''}>
      {isDone ? '✔ ' : '○ '}
      {text}
    </li>
  );
  return (
    <ul class="checklist">
      {GUIDED_STEPS.map((step) => item(done.proposed.has(step.id), step.title))}
      {item(done.approved, 'Approve the allowed order and see it filled')}
    </ul>
  );
}

function StepButton(props: { step: GuidedStep; number: number; csrfToken: string }) {
  return (
    <section class="box">
      <h2>
        {props.number}. {props.step.title}
      </h2>
      <p>{props.step.explanation}</p>
      <form method="post" action={`/try/${props.step.id}`}>
        <CsrfField token={props.csrfToken} />
        <button type="submit" class="big">
          {props.step.title}
        </button>
      </form>
    </section>
  );
}

function Result(props: { intent: IntentView }) {
  const { intent } = props;
  const failures = intent.checkResults.filter((check) => !check.passed);
  return (
    <section class="banner" id="result">
      <p>
        <strong>
          {intent.side.toUpperCase()} {intent.quantity} {intent.symbol}:{' '}
          {statusLabel(intent.status)}.
        </strong>
      </p>
      {failures.length === 0 ? null : (
        <ul>
          {failures.map((check) => (
            <li class="fail">{check.reason}</li>
          ))}
        </ul>
      )}
      {intent.status === 'PENDING_APPROVAL' ? (
        <a href={`/approvals/${intent.id}`} class="button">
          Review and approve
        </a>
      ) : null}
    </section>
  );
}

function PaperHoldings(props: { positions: readonly PaperPosition[] }) {
  if (props.positions.length === 0) {
    return null;
  }
  return (
    <p>
      Your paper (simulated) positions:{' '}
      {props.positions
        .map((p) => `${p.quantity} ${p.symbol} at ${fmtMoney(p.avgCost, p.currency)}`)
        .join(', ')}
      .
    </p>
  );
}

type TryPageProps = {
  readonly signedIn: SignedIn;
  readonly intents: readonly IntentView[];
  readonly result: IntentView | null;
  readonly paperPositions: readonly PaperPosition[];
  readonly mcpUrl: string;
};

export function TryPage(props: TryPageProps) {
  const csrfToken = props.signedIn.session.csrfToken;
  return (
    <Layout title="Guided demo" signedIn={props.signedIn}>
      <div class="page-head">
        <p class="eyebrow">Guided demo</p>
        <h1>See the guardrails in action</h1>
      </div>
      <p class="lead">
        Each button proposes an order the way an AI assistant would, through the same checks. Your
        policy: buys only, at most $100 per order and $250 a day, stocks and ETFs only.
      </p>
      <section class="box">
        <h2>Your progress</h2>
        <Checklist intents={props.intents} />
        <PaperHoldings positions={props.paperPositions} />
      </section>
      {props.result === null ? null : <Result intent={props.result} />}
      <div class="steps">
        {GUIDED_STEPS.map((step, index) => (
          <StepButton step={step} number={index + 1} csrfToken={csrfToken} />
        ))}
      </div>
      <section class="box">
        <h2>4. See what happened</h2>
        <p>
          Every proposal, check, approval, and fill is in the <a href="/audit">audit log</a>, with
          who did it and why.
        </p>
      </section>
      <section class="box">
        <h2>5. Optional: hit the kill switch</h2>
        <p>Cancels anything waiting for approval and refuses every new order until turned off.</p>
        <form method="post" action="/kill-switch">
          <CsrfField token={csrfToken} />
          <input type="hidden" name="state" value={props.signedIn.user.killSwitch ? 'off' : 'on'} />
          <button type="submit" class="danger">
            {props.signedIn.user.killSwitch ? 'Turn the kill switch off' : 'Hit the kill switch'}
          </button>
        </form>
      </section>
      <section class="box">
        <h2>6. Optional: connect Claude to this demo</h2>
        <p>
          In Claude: Settings → Connectors → Add custom connector → paste{' '}
          <code>{props.mcpUrl}</code> → Allow (this browser is already signed in to the demo). Then
          ask Claude to buy 1 XEQT.TO in the Demo TFSA.
        </p>
      </section>
    </Layout>
  );
}
