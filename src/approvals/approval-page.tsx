import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';
import { type ClaimResult, hasDifferingClaim } from '../claims/check-claims.js';
import type { AiReasoning } from '../intents/propose-input.js';
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
// our stored, resolved data so the human checks the real order. The only text the AI wrote is in
// the claim card (D30), shown as plain text and labelled as the AI's own words.

export const CLAIM_CARD_TITLE = 'What the AI believes vs what your broker says';
export const CLAIMS_DIFFER_BANNER =
  "The AI's reasoning doesn't match your broker's data. Check before approving.";

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
  const passedCount = props.intent.checkResults.filter((result) => result.passed).length;
  return (
    <section class="box">
      <h2>Policy checks</h2>
      <p class="notice">
        {passedCount} of {props.intent.checkResults.length} rules passed.
      </p>
      <ul class="checks">
        {props.intent.checkResults.map((result) => (
          <li class={result.passed ? 'pass' : 'fail'}>
            <span class="sr-only">{result.passed ? 'Pass: ' : 'Fail: '}</span>
            {result.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Differences first, so the human can't miss them; confirmed claims last.
const CLAIM_ORDER: Record<ClaimResult['status'], number> = {
  differs: 0,
  missing: 1,
  cannot_check: 1,
  matches: 2,
};

const CLAIM_CLASS: Record<ClaimResult['status'], string> = {
  differs: 'fail',
  missing: 'unsure',
  cannot_check: 'unsure',
  matches: 'pass',
};

const CLAIM_LABEL: Record<ClaimResult['status'], string> = {
  differs: "Doesn't match: ",
  missing: 'Not checked: ',
  cannot_check: 'Not checked: ',
  matches: 'Matches: ',
};

// Hostnames only ("example.com"), as plain text: never a link the human might click.
function sourceHostnames(sources: readonly string[]): string {
  const hostnames = sources.map((source) => URL.parse(source)?.hostname ?? '');
  return [...new Set(hostnames.filter((hostname) => hostname !== ''))].join(', ');
}

function AiWords(props: { reasoning: AiReasoning | null }) {
  const reasoning = props.reasoning;
  if (reasoning === null) {
    return null;
  }
  const hostnames = sourceHostnames(reasoning.sources ?? []);
  return (
    <>
      {reasoning.user_request === undefined ? null : (
        <p>
          <strong>In your words:</strong> {reasoning.user_request}
        </p>
      )}
      {reasoning.why === undefined ? null : (
        <p>
          <strong>The AI's reason:</strong> {reasoning.why}
        </p>
      )}
      {hostnames === '' ? null : (
        <p>
          <strong>Sources the AI used:</strong> {hostnames}
        </p>
      )}
    </>
  );
}

function ClaimCheck(props: { intent: IntentView; claimResults: readonly ClaimResult[] }) {
  const sorted = [...props.claimResults].sort(
    (first, second) => CLAIM_ORDER[first.status] - CLAIM_ORDER[second.status],
  );
  return (
    <section class="box">
      <h2>{CLAIM_CARD_TITLE}</h2>
      {sorted.length === 0 ? (
        <p class="notice">
          The AI didn't say what price or company it expected, so there was nothing to check.
        </p>
      ) : (
        <ul class="checks">
          {sorted.map((result) => (
            <li class={CLAIM_CLASS[result.status]}>
              <span class="sr-only">{CLAIM_LABEL[result.status]}</span>
              {result.message}
            </li>
          ))}
        </ul>
      )}
      <AiWords reasoning={props.intent.aiReasoning} />
      <p class="notice">
        The AI wrote these claims. The gateway checked its price and company against your broker's
        data. They don't change the policy checks.
      </p>
    </section>
  );
}

function Decision(props: { intent: IntentView; csrfToken: string }) {
  const { intent } = props;
  return (
    <section class="box">
      <h2>Your decision</h2>
      <p>
        This approval expires at <strong>{fmtToronto(intent.expiresAt)}</strong>.
      </p>
      <div class="decision-buttons">
        <form method="post" action={`/approvals/${intent.id}/approve`} class="inline">
          <CsrfField token={props.csrfToken} />
          <button type="submit" class="big">
            Approve
          </button>
        </form>{' '}
        <form method="post" action={`/approvals/${intent.id}/deny`} class="inline">
          <CsrfField token={props.csrfToken} />
          <button type="submit" class="secondary big">
            Deny
          </button>
        </form>
      </div>
    </section>
  );
}

function Outcome(props: { intent: IntentView; isDemo: boolean }) {
  const { intent } = props;
  const fill =
    intent.execution !== null && intent.execution.avgFillPrice !== null
      ? ` ${intent.execution.filledQuantity} at ${moneyOrDash(intent.execution.avgFillPrice, intent.currency)}${intent.mode === 'paper' ? ' (simulated)' : ''}.`
      : '';
  const extra = intent.status === 'EXPIRED' ? ' Ask the AI to propose again.' : '';
  return (
    <section class="box">
      <h2>Outcome</h2>
      <p>
        <strong>{statusLabel(intent.status)}.</strong>
        {fill}
        {extra}
      </p>
      <p>
        {props.isDemo ? (
          <a href="/try">Back to the guided demo</a>
        ) : (
          <a href="/dashboard">Back to the dashboard</a>
        )}
      </p>
    </section>
  );
}

// The one line a person reads first: what, how many, and roughly how much.
function OrderSummary(props: { intent: IntentView }) {
  const { intent } = props;
  return (
    <div class="card order-hero">
      <div>
        <p class="label">
          Proposed by {intent.proposedBy} · {intent.accountName}{' '}
          {maskedNumber(intent.accountNumberLast4)}
        </p>
        <p class="big">
          {sideLabel(intent.side)} {intent.quantity} {intent.symbol}
        </p>
      </div>
      <div>
        <p class="label">Estimated value</p>
        <p class="value">{moneyOrDash(intent.estValue, intent.currency)}</p>
      </div>
    </div>
  );
}

export function ApprovalPage(props: ApprovalPageProps) {
  const { intent, signedIn } = props;
  const isPending = intent.status === 'PENDING_APPROVAL';
  return (
    <Layout title="Review order" signedIn={signedIn} activePage="orders">
      <div class="page-head">
        <p class="eyebrow">{isPending ? 'Approval needed' : statusLabel(intent.status)}</p>
        <h1>
          Review order <ModeBadge mode={intent.mode} />
        </h1>
      </div>
      {intent.claimResults !== null && hasDifferingClaim(intent.claimResults) ? (
        <div class="banner danger">{CLAIMS_DIFFER_BANNER}</div>
      ) : null}
      {props.notice === undefined ? null : <div class="banner danger">{props.notice}</div>}
      <div class="banner">
        This order was proposed by an AI assistant. Check every detail. Approving is your decision.
      </div>
      {props.duplicateCount > 0 ? (
        <div class="banner">You have another pending order with identical details.</div>
      ) : null}
      <OrderSummary intent={intent} />
      {intent.claimResults === null ? null : (
        <ClaimCheck intent={intent} claimResults={intent.claimResults} />
      )}
      <div class="split">
        <section class="box">
          <h2>Order details</h2>
          <OrderDetails intent={intent} />
          <p class="notice">
            {intent.priceSource === 'none' ? UNAVAILABLE_DISCLAIMER : ESTIMATE_LABEL}
          </p>
          <p class="notice">{intent.priceSource === 'none' ? '' : ESTIMATE_DISCLAIMER}</p>
        </section>
        <div class="stack sticky">
          {isPending ? (
            <Decision intent={intent} csrfToken={signedIn.session.csrfToken} />
          ) : (
            <Outcome intent={intent} isDemo={signedIn.user.isDemo} />
          )}
          <PolicyChecks intent={intent} />
        </div>
      </div>
    </Layout>
  );
}
