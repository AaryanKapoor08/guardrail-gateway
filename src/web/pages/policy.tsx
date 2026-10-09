import type { Child } from 'hono/jsx';
import { CsrfField } from '../../auth/csrf.js';
import type { SignedIn } from '../../auth/sessions.js';
import {
  APPROVAL_WINDOW_MAX_MINUTES,
  APPROVAL_WINDOW_MIN_MINUTES,
  MAX_DAILY_VALUE_CEILING,
  MAX_ORDER_VALUE_CEILING,
  MAX_ORDERS_PER_DAY_CEILING,
  POLICY_CURRENCIES,
} from '../../policy/schema.js';
import type { PolicyFormValues } from '../../settings/policy-editor.js';
import { Layout } from '../layout.js';

type PolicyPageProps = {
  readonly signedIn: SignedIn;
  readonly values: PolicyFormValues;
  readonly version: number;
  readonly problems: readonly string[];
  readonly isSaved: boolean;
};

function SideCheckbox(props: { side: 'buy' | 'sell'; values: PolicyFormValues }) {
  return (
    <label>
      <input
        type="checkbox"
        name="allowedSides"
        value={props.side}
        checked={props.values.allowedSides.includes(props.side)}
      />{' '}
      {props.side === 'buy' ? 'Buy' : 'Sell (never more than you hold)'}
    </label>
  );
}

// A text box with its unit ("USD", "minutes") shown inside the box, and a plain-English hint.
function UnitField(props: {
  name: string;
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  const hintId = `${props.name}-hint`;
  return (
    <div class="field">
      <label for={props.name}>{props.label}</label>
      <div class="input-unit">
        <input
          id={props.name}
          name={props.name}
          value={props.value}
          inputmode="decimal"
          aria-describedby={hintId}
        />
        <span class="unit">{props.unit}</span>
      </div>
      <p class="hint" id={hintId}>
        {props.hint}
      </p>
    </div>
  );
}

function TextField(props: { name: string; label: string; value: string; hint: string }) {
  const hintId = `${props.name}-hint`;
  return (
    <div class="field">
      <label for={props.name}>{props.label}</label>
      <input id={props.name} name={props.name} value={props.value} aria-describedby={hintId} />
      <p class="hint" id={hintId}>
        {props.hint}
      </p>
    </div>
  );
}

function RuleCard(props: { eyebrow: string; title: string; intro: string; children: Child }) {
  return (
    <section class="box">
      <p class="eyebrow">{props.eyebrow}</p>
      <h2>{props.title}</h2>
      <p class="notice">{props.intro}</p>
      {props.children}
    </section>
  );
}

function SpendingLimits(props: { values: PolicyFormValues }) {
  const { values } = props;
  return (
    <RuleCard
      eyebrow="Money"
      title="Spending limits"
      intro="An order's value is the number of shares times the share price. These caps stop the AI from moving more money than you're comfortable with."
    >
      <UnitField
        name="maxOrderValue"
        label="Per-order limit"
        value={values.maxOrderValue}
        unit={values.policyCurrency}
        hint={`The most a single order can be worth. At most ${MAX_ORDER_VALUE_CEILING}.`}
      />
      <UnitField
        name="maxDailyValue"
        label="Daily limit"
        value={values.maxDailyValue}
        unit={values.policyCurrency}
        hint={`The most all of today's orders can add up to. Orders waiting for approval count too. At most ${MAX_DAILY_VALUE_CEILING}.`}
      />
      <UnitField
        name="maxOrdersPerDay"
        label="Orders per day"
        value={values.maxOrdersPerDay}
        unit="orders"
        hint={`The most orders allowed in one day. 1 to ${MAX_ORDERS_PER_DAY_CEILING}.`}
      />
    </RuleCard>
  );
}

function AllowedActions(props: { values: PolicyFormValues }) {
  return (
    <RuleCard
      eyebrow="Actions"
      title="What the AI may do"
      intro="Buying spends your cash on shares. Selling turns shares you already own back into cash."
    >
      <fieldset>
        <legend>Allowed actions</legend>
        <SideCheckbox side="buy" values={props.values} />
        <SideCheckbox side="sell" values={props.values} />
      </fieldset>
    </RuleCard>
  );
}

function SymbolLists(props: { values: PolicyFormValues }) {
  return (
    <RuleCard
      eyebrow="Stocks"
      title="Which stocks"
      intro="A symbol (or ticker) is the short code a stock or fund trades under, like AAPL for Apple."
    >
      <TextField
        name="symbolAllowlist"
        label="Allowed symbols"
        value={props.values.symbolAllowlist}
        hint="Separate with commas. Leave empty to allow any symbol."
      />
      <TextField
        name="symbolDenylist"
        label="Blocked symbols"
        value={props.values.symbolDenylist}
        hint="Separate with commas. A blocked symbol is always refused, even if it's allowed above."
      />
    </RuleCard>
  );
}

function CurrencyAndTiming(props: { values: PolicyFormValues }) {
  const { values } = props;
  return (
    <RuleCard
      eyebrow="Currency and time"
      title="Currency and approval window"
      intro="Your limits are counted in one currency, and every order waits a limited time for you."
    >
      <div class="field">
        <label for="policyCurrency">Currency</label>
        <select id="policyCurrency" name="policyCurrency" aria-describedby="policyCurrency-hint">
          {POLICY_CURRENCIES.map((currency) => (
            <option value={currency} selected={values.policyCurrency === currency}>
              {currency}
            </option>
          ))}
        </select>
        <p class="hint" id="policyCurrency-hint">
          Stocks and funds priced in another currency are refused (no conversion).
        </p>
      </div>
      <UnitField
        name="approvalWindowMinutes"
        label="Approval window"
        value={values.approvalWindowMinutes}
        unit="minutes"
        hint={`How long you have to approve an order before it expires. ${APPROVAL_WINDOW_MIN_MINUTES} to ${APPROVAL_WINDOW_MAX_MINUTES}.`}
      />
    </RuleCard>
  );
}

function PolicyForm(props: { values: PolicyFormValues; csrfToken: string }) {
  return (
    <form method="post" action="/policy" class="policy-form">
      <CsrfField token={props.csrfToken} />
      <div class="card-grid">
        <SpendingLimits values={props.values} />
        <AllowedActions values={props.values} />
        <SymbolLists values={props.values} />
        <CurrencyAndTiming values={props.values} />
      </div>
      <div class="save-bar">
        <p class="notice">Saved rules apply to every new order.</p>
        <button type="submit">Save policy</button>
      </div>
    </form>
  );
}

function FixedRules() {
  return (
    <section class="box">
      <div class="section-title">
        <h2>Fixed rules</h2>
        <span class="pill ok">Always on</span>
      </div>
      <p class="notice">These protect you no matter what your policy above says.</p>
      <ul class="checks">
        <li class="pass">Security types: stocks and ETFs only.</li>
        <li class="pass">Order types: market and limit, each lasting for the day only.</li>
        <li class="pass">
          Every order needs your approval on this website. This can't be turned off.
        </li>
        <li class="pass">No short selling: you can never sell more than you hold.</li>
      </ul>
    </section>
  );
}

export function PolicyPage(props: PolicyPageProps) {
  return (
    <Layout title="Policy" signedIn={props.signedIn}>
      <div class="page-head">
        <p class="eyebrow">Policy</p>
        <h1>Your trading policy</h1>
        <p class="lead">
          Every order the AI proposes is checked against these rules, at proposal and again when you
          approve. The AI can read them but never change them.
        </p>
        <span class="pill">Version {props.version}</span>
      </div>
      {props.isSaved ? <div class="banner">Saved. New orders use these rules.</div> : null}
      {props.problems.length === 0 ? null : (
        <div class="banner danger">
          <p>Nothing was saved:</p>
          <ul class="errors">
            {props.problems.map((problem) => (
              <li>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      <PolicyForm values={props.values} csrfToken={props.signedIn.session.csrfToken} />
      <FixedRules />
    </Layout>
  );
}
