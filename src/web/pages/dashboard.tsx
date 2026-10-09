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
  // Live orders already at the broker; the kill switch can't recall them (V§4.6).
  readonly ordersAtBroker: readonly IntentView[];
  // Why live mode can't be switched on right now (empty when it can).
  readonly liveModeProblems: readonly string[];
  readonly newAccounts: readonly AccountListItem[];
};

function KillSwitch(props: {
  isOn: boolean;
  ordersAtBroker: readonly IntentView[];
  csrfToken: string;
}) {
  return (
    <section class={props.isOn ? 'box danger-zone' : 'box'} id="kill-switch">
      <p class="eyebrow">Emergency stop</p>
      <h2>Kill switch: {props.isOn ? 'ON' : 'off'}</h2>
      <p>
        {props.isOn
          ? 'Every order the AI proposes is refused, and nothing can be approved.'
          : 'Turning it on cancels every order waiting for approval and refuses all new ones until you turn it off.'}
      </p>
      {props.isOn && props.ordersAtBroker.length > 0 ? (
        <div class="banner danger">
          <p>
            These orders were already sent to your broker and can't be recalled from here. Cancel
            them at your broker if you need to:
          </p>
          <ul>
            {props.ordersAtBroker.map((intent) => (
              <li>
                <a href={`/approvals/${intent.id}`}>
                  {sideLabel(intent.side)} {intent.quantity} {intent.symbol}
                </a>{' '}
                in {intent.accountName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form method="post" action="/kill-switch">
        <CsrfField token={props.csrfToken} />
        <input type="hidden" name="state" value={props.isOn ? 'off' : 'on'} />
        <button type="submit" class={props.isOn ? 'secondary' : 'danger'}>
          {props.isOn ? 'Turn the kill switch off' : 'Turn the kill switch on'}
        </button>
      </form>
    </section>
  );
}

function ModeSwitch(props: {
  mode: 'paper' | 'live';
  liveModeProblems: readonly string[];
  csrfToken: string;
}) {
  const canGoLive = props.liveModeProblems.length === 0;
  return (
    <section class="box" id="mode">
      <p class="eyebrow">Trading mode</p>
      <h2>Mode: {props.mode === 'paper' ? 'paper (simulated)' : 'LIVE (real orders)'}</h2>
      <p>
        Paper mode simulates fills in a ledger here; nothing is sent to a broker. Live mode sends
        approved orders to your broker.
      </p>
      <form method="post" action="/mode" class="inline">
        <CsrfField token={props.csrfToken} />
        <input type="hidden" name="mode" value={props.mode === 'paper' ? 'live' : 'paper'} />
        {props.mode === 'paper' ? (
          <button type="submit" disabled={!canGoLive}>
            Switch to live mode
          </button>
        ) : (
          <button type="submit">Switch to paper mode</button>
        )}
      </form>
      {props.mode === 'paper' && !canGoLive ? (
        <>
          <p>Live mode isn't available:</p>
          <ul class="checks">
            {props.liveModeProblems.map((problem) => (
              <li class="fail">{problem}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

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
      <button type="submit" class={account.allowed ? 'secondary small' : 'small'}>
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

function isConnectionHealthy(account: AccountListItem): boolean {
  return account.present && !account.connectionDisabled;
}

function AccountsTable(props: { accounts: readonly AccountListItem[]; csrfToken: string }) {
  if (props.accounts.length === 0) {
    return (
      <div class="empty">
        <p>
          <strong>No accounts yet.</strong>
        </p>
        <p class="notice">
          Connect a brokerage in your SnapTrade dashboard, then press Refresh from SnapTrade.
        </p>
      </div>
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
            <td>
              <span class={account.isPaper ? 'pill' : 'pill warn'}>
                {account.isPaper ? 'Paper' : 'Real'}
              </span>
            </td>
            <td>
              <span class={isConnectionHealthy(account) ? 'pill ok' : 'pill bad'}>
                {connectionStatus(account)}
              </span>
            </td>
            <td>
              <div class="cell-actions">
                <span class={account.allowed ? 'pill ok' : 'pill'}>
                  {account.allowed ? 'Allowed ' : 'Not allowed '}
                </span>
                <AllowToggle account={account} csrfToken={props.csrfToken} />
              </div>
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
      <p>
        <a href="/apps">Connected AI apps</a> (see and disconnect apps)
      </p>
    </section>
  );
}

// "Try it without an AI" (V§4.7): the same proposal path, recorded as the user's own test.
function ManualProposal(props: { accounts: readonly AccountListItem[]; csrfToken: string }) {
  const usable = props.accounts.filter((account) => account.allowed && account.present);
  return (
    <section class="box" id="try">
      <h2>Try it without an AI</h2>
      <p class="notice">
        Propose an order yourself. It goes through the same policy checks as the AI's orders.
      </p>
      {usable.length === 0 ? (
        <p>Allow an account above first.</p>
      ) : (
        <form method="post" action="/intents/manual">
          <CsrfField token={props.csrfToken} />
          <div class="form-grid">
            <div>
              <label for="account_ref">Account</label>
              <select id="account_ref" name="account_ref">
                {usable.map((account) => (
                  <option value={account.ref}>{account.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label for="symbol">Symbol</label>
              <input id="symbol" name="symbol" placeholder="AAPL" />
            </div>
            <div>
              <label for="side">Action</label>
              <select id="side" name="side">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <label for="quantity">Quantity</label>
              <input id="quantity" name="quantity" inputmode="decimal" placeholder="1" />
            </div>
            <div>
              <label for="order_type">Order type</label>
              <select id="order_type" name="order_type">
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
            </div>
            <div>
              <label for="limit_price">Limit price (limit orders only)</label>
              <input id="limit_price" name="limit_price" inputmode="decimal" />
            </div>
          </div>
          <p>
            <button type="submit">Propose</button>{' '}
            <span class="notice">It is checked by your policy and still needs your approval.</span>
          </p>
        </form>
      )}
    </section>
  );
}

function PendingRow(props: { intent: IntentView }) {
  const { intent } = props;
  return (
    <li class="list-row">
      <div>
        <p class="list-title">
          {sideLabel(intent.side)} {intent.quantity} {intent.symbol}
        </p>
        <p class="list-meta">
          {orderTypeLabel(intent)}, {intent.mode} · in {intent.accountName} · proposed by{' '}
          {intent.proposedBy}
        </p>
      </div>
      <div class="row-actions">
        <span class="pill warn">Expires {fmtToronto(intent.expiresAt)}</span>
        <a href={`/approvals/${intent.id}`} class="button small">
          Review
        </a>
      </div>
    </li>
  );
}

function PendingApprovals(props: { intents: readonly IntentView[] }) {
  return (
    <section id="pending">
      <div class="section-title">
        <h2>Pending approvals</h2>
        <a href="/intents" class="button secondary small">
          See all recent orders
        </a>
      </div>
      {props.intents.length === 0 ? (
        <div class="empty">
          <p>
            <strong>No orders are waiting for your approval.</strong>
          </p>
          <p class="notice">
            When the AI proposes an order that passes your policy, it shows up here for you to
            approve or deny. You can also try one yourself below.
          </p>
        </div>
      ) : (
        <ul class="list">
          {props.intents.map((intent) => (
            <PendingRow intent={intent} />
          ))}
        </ul>
      )}
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

function AccountsSection(props: { accounts: readonly AccountListItem[]; csrfToken: string }) {
  return (
    <section id="accounts">
      <div class="section-title">
        <div>
          <h2>Accounts</h2>
          <p class="notice">
            No account is allowed by default. The AI can only see and propose orders for accounts
            you allow here.
          </p>
        </div>
        <form method="post" action="/accounts/refresh" class="inline">
          <CsrfField token={props.csrfToken} />
          <button type="submit" class="secondary small">
            Refresh from SnapTrade
          </button>
        </form>
      </div>
      <AccountsTable accounts={props.accounts} csrfToken={props.csrfToken} />
    </section>
  );
}

function DisconnectBox(props: { csrfToken: string }) {
  return (
    <section class="box danger-zone">
      <p class="eyebrow">Danger zone</p>
      <h2>Disconnect SnapTrade</h2>
      <p>
        Revokes our access at SnapTrade, cuts off every connected AI app, and signs you out. Your
        history stays; you can sign in again later.
      </p>
      <form method="post" action="/disconnect">
        <CsrfField token={props.csrfToken} />
        <button type="submit" class="danger">
          Disconnect SnapTrade
        </button>
      </form>
      <p class="notice">
        Or <a href="/account/delete">delete your account</a> and everything we store.
      </p>
    </section>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

function StatusTile(props: {
  href: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  return (
    <a href={props.href} class={`tile ${props.tone}`}>
      <span class="tile-label">
        <span class={`dot ${props.tone}`} />
        {props.label}
      </span>
      <span class="tile-value">{props.value}</span>
      <span class="tile-detail">{props.detail}</span>
    </a>
  );
}

// The four things to know at a glance; each tile jumps to the card that changes it.
function StatusTiles(props: {
  signedIn: SignedIn;
  accounts: readonly AccountListItem[];
  pendingCount: number;
}) {
  const { user } = props.signedIn;
  const presentAccounts = props.accounts.filter((account) => account.present);
  const allowedCount = presentAccounts.filter((account) => account.allowed).length;
  const isPaper = user.mode === 'paper';
  return (
    <div class="tiles">
      <StatusTile
        href="#mode"
        label="Mode"
        value={isPaper ? 'Paper' : 'Live'}
        detail={isPaper ? 'Simulated, no real orders' : 'Approved orders go to your broker'}
        tone={isPaper ? 'ok' : 'bad'}
      />
      <StatusTile
        href="#kill-switch"
        label="Kill switch"
        value={user.killSwitch ? 'On' : 'Off'}
        detail={user.killSwitch ? 'Every new order is refused' : 'The AI can propose orders'}
        tone={user.killSwitch ? 'bad' : 'ok'}
      />
      <StatusTile
        href="#accounts"
        label="Allowed accounts"
        value={`${allowedCount} of ${presentAccounts.length}`}
        detail={allowedCount === 0 ? 'Allow one so the AI can use it' : 'The AI sees only these'}
        tone={allowedCount === 0 ? 'warn' : 'ok'}
      />
      <StatusTile
        href="#pending"
        label="Waiting for you"
        value={String(props.pendingCount)}
        detail={props.pendingCount === 0 ? 'Nothing to approve' : 'Review before they expire'}
        tone={props.pendingCount === 0 ? 'neutral' : 'warn'}
      />
    </div>
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
      <div class="page-head">
        <p class="eyebrow">Dashboard</p>
        <h1>Your guardrails</h1>
        <p class="lead">Signed in{email === null ? '' : ` as ${email}`}.</p>
      </div>
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
      {props.newAccounts.length > 0 ? (
        <div class="banner">
          New account found, not allowed yet:{' '}
          {props.newAccounts.map((account) => account.name).join(', ')}. Allow it below if the AI
          may use it.
        </div>
      ) : null}
      <StatusTiles
        signedIn={signedIn}
        accounts={props.accounts}
        pendingCount={props.pendingIntents.length}
      />
      <AccountsSection accounts={props.accounts} csrfToken={csrfToken} />
      <PendingApprovals intents={props.pendingIntents} />
      <ManualProposal accounts={props.accounts} csrfToken={csrfToken} />
      <PaperPositions positions={props.paperPositions} />
      <div class="card-grid">
        <KillSwitch
          isOn={signedIn.user.killSwitch}
          ordersAtBroker={props.ordersAtBroker}
          csrfToken={csrfToken}
        />
        <ModeSwitch
          mode={signedIn.user.mode}
          liveModeProblems={props.liveModeProblems}
          csrfToken={csrfToken}
        />
      </div>
      <McpBox mcpUrl={props.mcpUrl} />
      <DisconnectBox csrfToken={csrfToken} />
      <p class="notice">Not financial advice. Guardrail Gateway never recommends trades.</p>
    </Layout>
  );
}
