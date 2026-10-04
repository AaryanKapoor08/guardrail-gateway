import type { SignedIn } from '../../auth/sessions.js';
import { SignInChoices } from '../../demo/pages.js';
import { Layout } from '../layout.js';

export function HomePage(props: { signedIn: SignedIn | undefined }) {
  return (
    <Layout title="Home" signedIn={props.signedIn}>
      <h1>Let an AI assistant propose trades, inside rules you set</h1>
      <p>
        Guardrail Gateway sits between an AI assistant (like Claude) and the brokerage accounts you
        connected through SnapTrade. The AI can read the accounts you allow and <em>propose</em>{' '}
        orders. Every proposal is checked against your limits, and nothing happens until you approve
        it here. Paper (simulated) trading is the default.
      </p>
      <ul>
        <li>The AI proposes. Your rules and your approval decide.</li>
        <li>The AI can't approve orders, change your limits, or turn off the kill switch.</li>
        <li>Everything is recorded in an audit log.</li>
      </ul>
      {props.signedIn === undefined ? (
        <SignInChoices />
      ) : (
        <p>
          <a href="/dashboard" class="button">
            Go to your dashboard
          </a>
        </p>
      )}
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
