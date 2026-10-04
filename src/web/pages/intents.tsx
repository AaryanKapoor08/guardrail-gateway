import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import type { IntentView } from '../../intents/view.js';
import { fmtToronto } from '../../lib/time.js';
import { moneyOrDash, orderTypeLabel, sideLabel, statusLabel } from '../format.js';
import { Layout } from '../layout.js';

function CancelButton(props: { intent: IntentView; csrfToken: string }) {
  if (props.intent.status !== 'PENDING_APPROVAL') {
    return null;
  }
  return (
    <form method="post" action={`/intents/${props.intent.id}/cancel`} class="inline">
      <CsrfField token={props.csrfToken} />
      <button type="submit" class="secondary">
        Cancel
      </button>
    </form>
  );
}

// The last 50 intents, newest first (P8 task 8).
export function IntentsPage(props: { signedIn: SignedIn; intents: readonly IntentView[] }) {
  const csrfToken = props.signedIn.session.csrfToken;
  return (
    <Layout title="Recent orders" signedIn={props.signedIn}>
      <h1>Recent orders</h1>
      {props.intents.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Proposed</th>
              <th>Order</th>
              <th>Account</th>
              <th>Estimated value</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.intents.map((intent) => (
              <tr>
                <td>
                  {fmtToronto(intent.createdAt)} by {intent.proposedBy}
                </td>
                <td>
                  <a href={`/approvals/${intent.id}`}>
                    {sideLabel(intent.side)} {intent.quantity} {intent.symbol}
                  </a>{' '}
                  ({orderTypeLabel(intent)}, {intent.mode})
                </td>
                <td>{intent.accountName}</td>
                <td>{moneyOrDash(intent.estValue, intent.currency)}</td>
                <td>{statusLabel(intent.status)}</td>
                <td>
                  <CancelButton intent={intent} csrfToken={csrfToken} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  );
}
