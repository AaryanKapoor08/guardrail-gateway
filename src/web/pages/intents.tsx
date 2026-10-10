import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import { type Outcome, outcomeOf } from '../../intents/activity.js';
import type { IntentView } from '../../intents/view.js';
import { fmtToronto } from '../../lib/time.js';
import { moneyOrDash, orderTypeLabel, sideLabel, statusLabel } from '../format.js';
import { Layout } from '../layout.js';

// What the top bar's search asked for.
export type OrderSearch =
  | { readonly kind: 'all' }
  | { readonly kind: 'symbol'; readonly prefix: string }
  | { readonly kind: 'invalid' };

const OUTCOME_PILL: Readonly<Record<Outcome, string>> = {
  approved: 'pill ok',
  blocked: 'pill bad',
  denied_or_expired: 'pill',
  waiting: 'pill warn',
};

function CancelButton(props: { intent: IntentView; csrfToken: string }) {
  if (props.intent.status !== 'PENDING_APPROVAL') {
    return null;
  }
  return (
    <form method="post" action={`/intents/${props.intent.id}/cancel`} class="inline">
      <CsrfField token={props.csrfToken} />
      <button type="submit" class="secondary small">
        Cancel
      </button>
    </form>
  );
}

function SearchNote(props: { search: OrderSearch }) {
  if (props.search.kind === 'all') {
    return null;
  }
  return (
    <div class="banner">
      {props.search.kind === 'symbol'
        ? `Showing orders for symbols starting with ${props.search.prefix}.`
        : 'A symbol is letters, digits, dots, or dashes, like XEQT.TO. Showing every order instead.'}{' '}
      <a href="/intents">Show all orders</a>
    </div>
  );
}

function IntentRow(props: { intent: IntentView; csrfToken: string }) {
  const { intent } = props;
  return (
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
      <td>
        <span class={OUTCOME_PILL[outcomeOf(intent.status)]}>{statusLabel(intent.status)}</span>
      </td>
      <td>
        <CancelButton intent={intent} csrfToken={props.csrfToken} />
      </td>
    </tr>
  );
}

// The last 50 intents, newest first (P8 task 8), optionally only one symbol's.
export function IntentsPage(props: {
  signedIn: SignedIn;
  intents: readonly IntentView[];
  search: OrderSearch;
}) {
  const csrfToken = props.signedIn.session.csrfToken;
  return (
    <Layout title="Recent orders" signedIn={props.signedIn} activePage="orders">
      <div class="page-head">
        <p class="eyebrow">Orders</p>
        <h1>Recent orders</h1>
      </div>
      <SearchNote search={props.search} />
      <section class="box">
        {props.intents.length === 0 ? (
          <p>
            {props.search.kind === 'symbol' ? 'No orders match that symbol.' : 'No orders yet.'}
          </p>
        ) : (
          <div class="table-scroll">
            <table class="data-table">
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
                  <IntentRow intent={intent} csrfToken={csrfToken} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
