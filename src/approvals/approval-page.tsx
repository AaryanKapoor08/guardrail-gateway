import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';
import type { IntentView } from '../intents/view.js';
import { fmtToronto } from '../lib/time.js';
import {
  maskedNumber,
  moneyOrDash,
  orderTypeLabel,
  priceSourceDetail,
  sideLabel,
  statusLabel,
  typeLabel,
} from '../web/format.js';
import { Layout } from '../web/layout.js';

// The approval page, following SnapTrade's Order Impact and Confirmation guide (V§9.2). It shows
// our stored, resolved data (never text the AI wrote) so the human checks the real order.

const ESTIMATE_LABEL =
  'Impact source: Application-generated estimate — This application calculated these amounts using the latest available quote and fee assumptions. They were not supplied or verified by SnapTrade or the brokerage.';

const ESTIMATE_DISCLAIMER =
  'Estimated results. The amounts shown are estimates only and are not guaranteed. The brokerage determines the final execution price, transaction amount, commissions, fees, and cash impact. Market orders can fill at a different price than the latest quote, and orders may partially fill or fill over multiple days. Exchange, ECN, regulatory, ADR, foreign-exchange, borrow, and other fees may apply, including when estimated commissions are $0.00.';

const UNAVAILABLE_DISCLAIMER =
  'Order impact unavailable. A reliable pre-trade impact or fee estimate is not available for this order. The final execution price, transaction amount, commissions, fees, and cash impact may not be known until the order is submitted or executed. Fees may apply.';

type ApprovalPageProps = {
  readonly signedIn: SignedIn;
  readonly intent: IntentView;
  readonly duplicateCount: number;
  // A one-off message, e.g. "Couldn't get a fresh price…".
  readonly notice?: string | undefined;
};

function ModeBadge(props: { mode: IntentView['mode'] }) {
  return props.mode === 'live' ? (
    <span class="badge live">LIVE: a real order</span>
  ) : (
    <span class="badge">PAPER: simulated, no real order</span>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <tr>
      <th>{props.label}</th>
      <td>{props.value}</td>
    </tr>
  );
}

function OrderDetails(props: { intent: IntentView }) {
  const { intent } = props;
  const isEstimated = intent.priceSource !== 'none';
  return (
    <table>
      <tbody>
        <Row label="Proposed by" value={`${intent.proposedBy}, ${fmtToronto(intent.createdAt)}`} />
        <Row
          label="Account"
          value={`${intent.institutionName}: ${intent.accountName}${intent.accountRawType === null ? '' : ` (${intent.accountRawType})`}, ${maskedNumber(intent.accountNumberLast4)}`}
        />
        <Row
          label="Security"
          value={`${intent.symbol}${intent.securityName === null ? '' : `, ${intent.securityName}`}`}
        />
        <Row
          label="Exchange, type, currency"
          value={`${intent.exchange ?? 'Unknown exchange'}, ${typeLabel(intent.securityType)}, ${intent.currency}`}
        />
        <Row label="Action" value={sideLabel(intent.side)} />
        <Row label="Quantity" value={intent.quantity} />
        <Row label="Order type" value={orderTypeLabel(intent)} />
        <Row label="Time in force" value="Day (ends at today's market close)" />
        <Row label="Estimated price" value={moneyOrDash(intent.estPrice, intent.currency)} />
        <Row
          label="Price source"
          value={
            isEstimated
              ? `Application-generated estimate: ${priceSourceDetail(intent)}`
              : 'Not available'
          }
        />
        <Row label="Estimated value" value={moneyOrDash(intent.estValue, intent.currency)} />
        <Row
          label="Fees and commissions"
          value={intent.mode === 'paper' ? 'None (simulated)' : 'Not available'}
        />
      </tbody>
    </table>
  );
}

function PolicyChecks(props: { intent: IntentView }) {
  return (
    <section>
      <h2>Policy checks</h2>
      <ul>
        {props.intent.checkResults.map((result) => (
          <li class={result.passed ? 'pass' : 'fail'}>
            {result.passed ? 'Pass: ' : 'Fail: '}
            {result.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Decision(props: { intent: IntentView; csrfToken: string }) {
  const { intent } = props;
  return (
    <section class="box">
      <p>
        This approval expires at <strong>{fmtToronto(intent.expiresAt)}</strong>.
      </p>
      <form method="post" action={`/approvals/${intent.id}/approve`} class="inline">
        <CsrfField token={props.csrfToken} />
        <button type="submit">Approve</button>
      </form>{' '}
      <form method="post" action={`/approvals/${intent.id}/deny`} class="inline">
        <CsrfField token={props.csrfToken} />
        <button type="submit" class="secondary">
          Deny
        </button>
      </form>
    </section>
  );
}

function Outcome(props: { intent: IntentView }) {
  const { intent } = props;
  const fill =
    intent.execution !== null && intent.execution.avgFillPrice !== null
      ? ` ${intent.execution.filledQuantity} at ${moneyOrDash(intent.execution.avgFillPrice, intent.currency)}${intent.mode === 'paper' ? ' (simulated)' : ''}.`
      : '';
  const extra = intent.status === 'EXPIRED' ? ' Ask the AI to propose again.' : '';
  return (
    <section class="box">
      <p>
        <strong>{statusLabel(intent.status)}.</strong>
        {fill}
        {extra}
      </p>
      <p>
        <a href="/dashboard">Back to the dashboard</a>
      </p>
    </section>
  );
}

export function ApprovalPage(props: ApprovalPageProps) {
  const { intent, signedIn } = props;
  const isPending = intent.status === 'PENDING_APPROVAL';
  return (
    <Layout title="Review order" signedIn={signedIn}>
      <h1>
        Review order <ModeBadge mode={intent.mode} />
      </h1>
      {props.notice === undefined ? null : <div class="banner danger">{props.notice}</div>}
      <div class="banner">
        This order was proposed by an AI assistant. Check every detail. Approving is your decision.
      </div>
      {props.duplicateCount > 0 ? (
        <div class="banner">You have another pending order with identical details.</div>
      ) : null}
      <OrderDetails intent={intent} />
      <p class="notice">
        {intent.priceSource === 'none' ? UNAVAILABLE_DISCLAIMER : ESTIMATE_LABEL}
      </p>
      <p class="notice">{intent.priceSource === 'none' ? '' : ESTIMATE_DISCLAIMER}</p>
      <PolicyChecks intent={intent} />
      {isPending ? (
        <Decision intent={intent} csrfToken={signedIn.session.csrfToken} />
      ) : (
        <Outcome intent={intent} />
      )}
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
