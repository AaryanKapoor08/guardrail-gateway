import type { Child } from 'hono/jsx';
import type { AccountListItem } from '../../accounts/service.js';
import type { SignedIn } from '../../auth/sessions.js';
import { hasDifferingClaim } from '../../claims/check-claims.js';
import type { ActivitySummary, Outcome } from '../../intents/activity.js';
import { outcomeOf } from '../../intents/activity.js';
import type { IntentView } from '../../intents/view.js';
import { BarChart, LineChart } from '../components/charts.js';
import {
  ArrowRightIcon,
  ClockIcon,
  DotsIcon,
  FlaskIcon,
  PowerIcon,
  SparklesIcon,
  WalletIcon,
} from '../components/icons.js';
import { moneyOrDash, sideLabel, statusLabel } from '../format.js';

// The top of the dashboard: four status cards, two activity charts, the latest orders, and how
// to connect an AI. Every number is real; an empty account shows zeros, never sample data.

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

function StatCard(props: {
  href: string;
  label: string;
  icon: Child;
  value: string;
  pill: string;
  tone: Tone;
  detail: string;
}) {
  return (
    <a href={props.href} class="stat-card">
      <span class="stat-head">
        <span class="stat-label">{props.label}</span>
        <span class="stat-icon">{props.icon}</span>
      </span>
      <span class="stat-body">
        <span class="stat-value">{props.value}</span>
        <span class={`trend ${props.tone}`}>{props.pill}</span>
      </span>
      <span class="stat-detail">{props.detail}</span>
    </a>
  );
}

function waitingPill(pendingIntents: readonly IntentView[]): { pill: string; tone: Tone } {
  const flaggedCount = pendingIntents.filter(
    (intent) => intent.claimResults !== null && hasDifferingClaim(intent.claimResults),
  ).length;
  if (flaggedCount > 0) {
    return { pill: `${flaggedCount} flagged by claim check`, tone: 'warn' };
  }
  return pendingIntents.length === 0
    ? { pill: 'All clear', tone: 'neutral' }
    : { pill: 'Review soon', tone: 'warn' };
}

// The four things to know at a glance; each card jumps to the card that changes it.
export function StatCards(props: {
  signedIn: SignedIn;
  accounts: readonly AccountListItem[];
  pendingIntents: readonly IntentView[];
}) {
  const { user } = props.signedIn;
  const presentAccounts = props.accounts.filter((account) => account.present);
  const allowedCount = presentAccounts.filter((account) => account.allowed).length;
  const isPaper = user.mode === 'paper';
  const pendingCount = props.pendingIntents.length;
  const waiting = waitingPill(props.pendingIntents);
  return (
    <div class="stat-grid">
      <StatCard
        href="#mode"
        label="Mode"
        icon={<FlaskIcon />}
        value={isPaper ? 'Paper' : 'Live'}
        pill={isPaper ? 'No real money' : 'Real orders'}
        tone={isPaper ? 'ok' : 'bad'}
        detail={isPaper ? 'Simulated, no real orders' : 'Approved orders go to your broker'}
      />
      <StatCard
        href="#kill-switch"
        label="Kill switch"
        icon={<PowerIcon />}
        value={user.killSwitch ? 'On' : 'Off'}
        pill={user.killSwitch ? 'All refused' : 'Orders allowed'}
        tone={user.killSwitch ? 'bad' : 'ok'}
        detail={user.killSwitch ? 'Every new order is refused' : 'The AI can propose orders'}
      />
      <StatCard
        href="#accounts"
        label="Allowed accounts"
        icon={<WalletIcon />}
        value={`${allowedCount} of ${presentAccounts.length}`}
        pill={allowedCount === 0 ? 'None allowed' : 'Ready'}
        tone={allowedCount === 0 ? 'warn' : 'ok'}
        detail={allowedCount === 0 ? 'Allow one so the AI can use it' : 'The AI sees only these'}
      />
      <StatCard
        href="#pending"
        label="Waiting for you"
        icon={<ClockIcon />}
        value={String(pendingCount)}
        pill={waiting.pill}
        tone={waiting.tone}
        detail={pendingCount === 0 ? 'Nothing to approve' : 'Review before they expire'}
      />
    </div>
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ActivityCards(props: { activity: ActivitySummary; days: number }) {
  const { activity } = props;
  const proposed = activity.days.map((day) => day.proposed);
  const approved = activity.days.map((day) => day.approved);
  return (
    <>
      <section class="card chart-card">
        <div class="card-head">
          <h2>Orders in the last {props.days} days</h2>
          <span class="card-note">
            {sum(proposed)} proposed · {sum(approved)} approved
          </span>
        </div>
        <LineChart
          description={`Orders proposed and approved per day over the last ${props.days} days`}
          labels={activity.days.map((day) => day.label)}
          series={[
            { name: 'Proposed', tone: 'cyan', values: proposed },
            { name: 'Approved by you', tone: 'green', values: approved },
          ]}
        />
      </section>
      <section class="card chart-card">
        <div class="card-head">
          <h2>Outcomes by weekday</h2>
        </div>
        <BarChart
          description={`Approved, blocked, and denied or expired orders by weekday over the last ${props.days} days`}
          labels={activity.weekdays.map((day) => day.weekday)}
          series={[
            {
              name: 'Approved',
              tone: 'blue',
              values: activity.weekdays.map((day) => day.approved),
            },
            { name: 'Blocked', tone: 'sky', values: activity.weekdays.map((day) => day.blocked) },
            {
              name: 'Denied or expired',
              tone: 'pale',
              values: activity.weekdays.map((day) => day.deniedOrExpired),
            },
          ]}
        />
      </section>
    </>
  );
}

const OUTCOME_TONE: Readonly<Record<Outcome, Tone>> = {
  approved: 'ok',
  blocked: 'bad',
  denied_or_expired: 'neutral',
  waiting: 'warn',
};

function RecentOrderRow(props: { intent: IntentView }) {
  const { intent } = props;
  return (
    <tr>
      <td>
        <a href={`/approvals/${intent.id}`} class="order-id" title="Review this order">
          #{intent.id.slice(0, 6)}
        </a>
      </td>
      <td>
        <span class="order-name">
          <span class={`side-chip ${intent.side}`}>{sideLabel(intent.side)}</span>
          {intent.quantity} {intent.symbol}
        </span>
      </td>
      <td>
        <span class={`pill ${OUTCOME_TONE[outcomeOf(intent.status)]}`}>
          {statusLabel(intent.status)}
        </span>
      </td>
      <td>{moneyOrDash(intent.estValue, intent.currency)}</td>
      <td>{intent.proposedBy}</td>
    </tr>
  );
}

function RecentOrders(props: { intents: readonly IntentView[] }) {
  return (
    <section class="card table-card">
      <div class="card-head">
        <h2>Recent orders</h2>
        <details class="card-menu">
          <summary title="More">
            <DotsIcon />
            <span class="sr-only">More</span>
          </summary>
          <div class="menu">
            <a href="/intents">See all orders</a>
            <a href="/audit">Open the audit log</a>
          </div>
        </details>
      </div>
      {props.intents.length === 0 ? (
        <p class="notice">No orders yet. Ask your AI to propose one, or try one yourself below.</p>
      ) : (
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Order</th>
                <th>Status</th>
                <th>Estimated value</th>
                <th>Proposed by</th>
              </tr>
            </thead>
            <tbody>
              {props.intents.map((intent) => (
                <RecentOrderRow intent={intent} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ConnectAi(props: { mcpUrl: string }) {
  return (
    <section class="card ai-card">
      <div class="card-head">
        <h2>Connect your AI</h2>
        <span class="card-icon">
          <SparklesIcon />
        </span>
      </div>
      <div class="orb" />
      <p class="ai-steps">
        <strong>Claude (web or desktop):</strong> Settings → Connectors → Add custom connector →
        paste this URL → sign in and approve.
      </p>
      <div class="ask-pill">
        <code>{props.mcpUrl}</code>
        <a href="/apps" class="send-button" title="Connected AI apps">
          <ArrowRightIcon />
          <span class="sr-only">Connected AI apps</span>
        </a>
      </div>
      <p class="ai-steps">
        <strong>Claude Code:</strong>{' '}
        <code>{`claude mcp add --transport http guardrail ${props.mcpUrl}`}</code>
      </p>
    </section>
  );
}

export function Overview(props: {
  activity: ActivitySummary;
  activityDays: number;
  recentIntents: readonly IntentView[];
  mcpUrl: string;
}) {
  return (
    <div class="overview-grid">
      <ActivityCards activity={props.activity} days={props.activityDays} />
      <RecentOrders intents={props.recentIntents} />
      <ConnectAi mcpUrl={props.mcpUrl} />
    </div>
  );
}
