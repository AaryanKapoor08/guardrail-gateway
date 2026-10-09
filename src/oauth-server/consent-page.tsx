import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';
import { Layout } from '../web/layout.js';

// The consent screen for connecting an AI app (V§4.2 step 4). It names the host of the app's
// client_id URL (which we checked), never the name the app gives itself, and the host it will
// send the user back to.

type ConsentPageProps = {
  readonly signedIn: SignedIn;
  readonly requestId: string;
  readonly ourHost: string;
  readonly clientHost: string;
  readonly redirectHost: string;
  readonly isLoopback: boolean;
  readonly canStayConnected: boolean;
};

function DecisionForm(props: {
  csrfToken: string;
  requestId: string;
  decision: 'approve' | 'deny';
}) {
  return (
    <form method="post" action="/oauth/authorize/decision" class="inline">
      <CsrfField token={props.csrfToken} />
      <input type="hidden" name="request" value={props.requestId} />
      <input type="hidden" name="decision" value={props.decision} />
      {props.decision === 'approve' ? (
        <button type="submit">Allow</button>
      ) : (
        <button type="submit" class="secondary">
          Deny
        </button>
      )}
    </form>
  );
}

export function ConsentPage(props: ConsentPageProps) {
  const csrfToken = props.signedIn.session.csrfToken;
  return (
    <Layout title="Connect an AI app" signedIn={props.signedIn}>
      <div class="page-head">
        <p class="eyebrow">Connect an AI app</p>
        <h1>Connect {props.clientHost} to Guardrail Gateway?</h1>
      </div>
      <p>
        You are on <strong>{props.ourHost}</strong>. The app asking for access is{' '}
        <strong>{props.clientHost}</strong>. After you decide, you'll be sent back to{' '}
        <strong>{props.redirectHost}</strong>.
      </p>
      {props.isLoopback ? (
        <div class="banner danger">
          This app runs on your own computer (it receives access at {props.redirectHost}). Only
          allow it if you just started connecting from a program on this computer, like Claude Code.
        </div>
      ) : null}
      <section class="box">
        <p>
          <strong>
            This app can read the accounts you allowed and propose orders. Every order needs your
            approval here.
          </strong>
        </p>
        <ul>
          <li>
            It can't approve orders, change your limits, use the kill switch, or switch to live
            trading.
          </li>
          {props.canStayConnected ? (
            <li>
              It can stay connected for up to 30 days. You can disconnect it at any time under
              Connected AI apps.
            </li>
          ) : null}
        </ul>
      </section>
      <DecisionForm csrfToken={csrfToken} requestId={props.requestId} decision="approve" />{' '}
      <DecisionForm csrfToken={csrfToken} requestId={props.requestId} decision="deny" />
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
