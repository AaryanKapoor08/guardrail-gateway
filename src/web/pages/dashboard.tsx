import type { AccountListItem } from '../../accounts/service.js';
import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import type { PaperPosition } from '../../executors/paper.js';
import type { IntentView } from '../../intents/view.js';
import { fmtMoney } from '../../lib/money.js';
import { fmtToronto } from '../../lib/time.js';
import { orderTypeLabel, sideLabel } from '../format.js';
import { Layout } from '../layout.js';

// Why the account list may be out of date on this page load.
export type SyncProblem = 'needs-reauth' | 'unavailable' | null;

type DashboardProps = {
  readonly signedIn: SignedIn;
  readonly accounts: readonly AccountListItem[];
  readonly syncProblem: SyncProblem;
  readonly mcpUrl: string;
  readonly pendingIntents: readonly IntentView[];
  readonly paperPositions: readonly PaperPosition[];
};

function ReconnectBanner() {
  return (
    <div class="banner danger">
      <p>
        Your SnapTrade connection needs to be renewed. Until you sign in again, the AI can't read
        your accounts or propose orders.
      </p>
      <a href="/login" class="button">
        Reconnect SnapTrade
      </a>
    </div>
  );
}

function AllowToggle(props: { account: AccountListItem; csrfToken: string }) {
  const { account } = props;
  return (
    <form method="post" action={`/accounts/${account.ref}/allow`} class="inline">
      <CsrfField token={props.csrfToken} />
      <input type="hidden" name="allowed" value={account.allowed ? 'false' : 'true'} />
      <button type="submit" class={account.allowed ? 'secondary' : ''}>
        {account.allowed ? 'Disallow' : 'Allow'}
      </button>
    </form>
  );
}

function connectionStatus(account: AccountListItem): string {
  if (!account.present) {
    return 'No longer at SnapTrade';
  }
  if (account.connectionDisabled) {
    return 'Connection broken';
  }
  return account.connectionType === 'trade' ? 'OK (trading enabled)' : 'OK (read-only)';
}

function AccountsTable(props: { accounts: readonly AccountListItem[]; csrfToken: string }) {
  if (props.accounts.length === 0) {
    return (
      <p>No accounts yet. Connect a brokerage in your SnapTrade dashboard, then press Refresh.</p>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Institution</th>
          <th>Account</th>
          <th>Type</th>
          <th>Number</th>
          <th>Paper or real</th>
          <th>Connection</th>
          <th>AI may use it?</th>
        </tr>
      </thead>
      <tbody>
        {props.accounts.map((account) => (
          <tr>
            <td>{account.institutionName}</td>
            <td>{account.name}</td>
            <td>
              {account.rawType ?? 'Unknown'}
              {account.accountCategory === null ? '' : ` (${account.accountCategory})`}
            </td>
            <td>{account.numberLast4 === null ? 'Not provided' : `••••${account.numberLast4}`}</td>
            <td>{account.isPaper ? 'Paper' : 'Real'}</td>
            <td>{connectionStatus(account)}</td>
            <td>
              {account.allowed ? 'Allowed ' : 'Not allowed '}
              <AllowToggle account={account} csrfToken={props.csrfToken} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function McpBox(props: { mcpUrl: string }) {
  return (
    <section class="box">
      <h2>Connect an AI assistant</h2>
      <p>
        Connector URL: <code>{props.mcpUrl}</code>
      </p>
      <p>
        <strong>Claude (web or desktop):</strong> Settings → Connectors → Add custom connector →
        paste the URL above → sign in and approve.
      </p>
      <p>
        <strong>Claude Code:</strong>{' '}
        <code>{`claude mcp add --transport http guardrail ${props.mcpUrl}`}</code>
      </p>
    </section>
  );
}

function PendingApprovals(props: { intents: readonly IntentView[] }) {
  return (
    <section>
      <h2>Pending approvals</h2>
      {props.intents.length === 0 ? (
        <p>No orders are waiting for your approval.</p>
      ) : (
        <ul>
          {props.intents.map((intent) => (
            <li>
              <a href={`/approvals/${intent.id}`}>
                {sideLabel(intent.side)} {intent.quantity} {intent.symbol} ({orderTypeLabel(intent)}
                , {intent.mode})
              </a>{' '}
              in {intent.accountName}, proposed by {intent.proposedBy}. Expires{' '}
              {fmtToronto(intent.expiresAt)}.
            </li>
          ))}
        </ul>
      )}
      <p>
        <a href="/intents">See all recent orders</a>
      </p>
    </section>
  );
}

function PaperPositions(props: { positions: readonly PaperPosition[] }) {
  if (props.positions.length === 0) {
    return null;
  }
  return (
    <section>
      <h2>Paper positions (simulated)</h2>
      <p class="notice">
        Changes from approved paper orders. Nothing here is held at a real broker. A negative
        quantity is a simulated sale of shares you hold for real.
      </p>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Symbol</th>
            <th>Quantity</th>
            <th>Average cost</th>
          </tr>
        </thead>
        <tbody>
          {props.positions.map((position) => (
            <tr>
              <td>{position.accountName}</td>
              <td>{position.symbol}</td>
              <td>{position.quantity}</td>
              <td>{fmtMoney(position.avgCost, position.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function DashboardPage(props: DashboardProps) {
  const { signedIn } = props;
  const csrfToken = signedIn.session.csrfToken;
  const email = signedIn.user.email;
  const hasBrokenConnection = props.accounts.some(
    (account) => account.present && account.connectionDisabled,
  );
  const needsReauth = signedIn.user.needsReauth || props.syncProblem === 'needs-reauth';
  return (
    <Layout title="Dashboard" signedIn={signedIn}>
      <h1>Dashboard</h1>
      <p>Signed in{email === null ? '' : ` as ${email}`}.</p>
      {needsReauth ? <ReconnectBanner /> : null}
      {props.syncProblem === 'unavailable' ? (
        <div class="banner">
          We couldn't reach SnapTrade just now, so this list may be out of date. Try Refresh in a
          minute.
        </div>
      ) : null}
      {hasBrokenConnection ? (
        <div class="banner danger">
          A brokerage connection is broken. Fix it in your SnapTrade dashboard; until then, orders
          for its accounts are refused.
        </div>
      ) : null}
      <section>
        <h2>Accounts</h2>
        <p>
          No account is allowed by default. The AI can only see and propose orders for accounts you
          allow here.
        </p>
        <AccountsTable accounts={props.accounts} csrfToken={csrfToken} />
        <form method="post" action="/accounts/refresh">
          <CsrfField token={csrfToken} />
          <button type="submit" class="secondary">
            Refresh from SnapTrade
          </button>
        </form>
      </section>
      <PendingApprovals intents={props.pendingIntents} />
      <PaperPositions positions={props.paperPositions} />
      <McpBox mcpUrl={props.mcpUrl} />
      <section class="box">
        <h2>Disconnect SnapTrade</h2>
        <p>
          Revokes our access at SnapTrade, cuts off every connected AI app, and signs you out. Your
          history stays; you can sign in again later.
        </p>
        <form method="post" action="/disconnect">
          <CsrfField token={csrfToken} />
          <button type="submit" class="danger">
            Disconnect SnapTrade
          </button>
        </form>
      </section>
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
