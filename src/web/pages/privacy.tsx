import type { SignedIn } from '../../auth/sessions.js';
import { Layout } from '../layout.js';

// Public: what we store, why, for how long, and how to delete it (V§13 Privacy).
export function PrivacyPage(props: { signedIn: SignedIn | undefined }) {
  return (
    <Layout title="Privacy" signedIn={props.signedIn}>
      <h1>Privacy</h1>
      <h2>What we store, and why</h2>
      <ul>
        <li>
          <strong>Your SnapTrade user id and email</strong>, from signing in with SnapTrade, to know
          who you are and (optionally) email you when an order needs your approval.
        </li>
        <li>
          <strong>Your SnapTrade access tokens</strong>, encrypted (AES-256-GCM), to read the
          accounts you allow on your behalf.
        </li>
        <li>
          <strong>Account details</strong>: institution, name, type, and only the last 4 digits of
          the account number, so you can choose which accounts the AI may use.
        </li>
        <li>
          <strong>
            Your policy, the orders the AI proposed, paper (simulated) fills, and connected AI apps
          </strong>
          , so the product works.
        </li>
        <li>
          <strong>An audit log</strong> of every action, so you can see exactly what happened.
        </li>
      </ul>
      <p>
        We never see or store your brokerage username or password. SnapTrade handles brokerage
        logins. Positions, balances, and prices are read from SnapTrade when needed and kept in
        memory for at most a few minutes.
      </p>
      <h2>How long</h2>
      <ul>
        <li>Sign-in sessions: 24 hours.</li>
        <li>Webhook notifications from SnapTrade: 30 days.</li>
        <li>Everything else: until you delete your account.</li>
        <li>Demo accounts: deleted automatically after 24 hours.</li>
      </ul>
      <h2>How to delete it</h2>
      <p>
        Sign in and choose <a href="/account/delete">Delete account</a>. We revoke our access at
        SnapTrade and delete every row we hold about you, including the audit log.
      </p>
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
