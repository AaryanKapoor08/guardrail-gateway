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

function NumberField(props: { name: string; label: string; value: string; hint: string }) {
  return (
    <>
      <label for={props.name}>{props.label}</label>
      <input id={props.name} name={props.name} value={props.value} inputmode="decimal" />{' '}
      <span class="notice">{props.hint}</span>
    </>
  );
}

function PolicyForm(props: { values: PolicyFormValues; csrfToken: string }) {
  const { values } = props;
  return (
    <form method="post" action="/policy">
      <CsrfField token={props.csrfToken} />
      <fieldset>
        <legend>Allowed actions</legend>
        <SideCheckbox side="buy" values={values} />
        <SideCheckbox side="sell" values={values} />
      </fieldset>
      <NumberField
        name="maxOrderValue"
        label="Per-order limit"
        value={values.maxOrderValue}
        hint={`At most ${MAX_ORDER_VALUE_CEILING}.`}
      />
      <NumberField
        name="maxDailyValue"
        label="Daily limit"
        value={values.maxDailyValue}
        hint={`At most ${MAX_DAILY_VALUE_CEILING}. Orders waiting for approval count too.`}
      />
      <NumberField
        name="maxOrdersPerDay"
        label="Orders per day"
        value={values.maxOrdersPerDay}
        hint={`1 to ${MAX_ORDERS_PER_DAY_CEILING}.`}
      />
      <label for="symbolAllowlist">Allowed symbols (comma-separated; empty means any)</label>
      <input id="symbolAllowlist" name="symbolAllowlist" value={values.symbolAllowlist} />
      <label for="symbolDenylist">Blocked symbols (comma-separated)</label>
      <input id="symbolDenylist" name="symbolDenylist" value={values.symbolDenylist} />
      <label for="policyCurrency">Currency</label>
      <select id="policyCurrency" name="policyCurrency">
        {POLICY_CURRENCIES.map((currency) => (
          <option value={currency} selected={values.policyCurrency === currency}>
            {currency}
          </option>
        ))}
      </select>{' '}
      <span class="notice">Securities in other currencies are refused (no conversion).</span>
      <NumberField
        name="approvalWindowMinutes"
        label="Approval window (minutes)"
        value={values.approvalWindowMinutes}
        hint={`${APPROVAL_WINDOW_MIN_MINUTES} to ${APPROVAL_WINDOW_MAX_MINUTES}.`}
      />
      <p>
        <button type="submit">Save policy</button>
      </p>
    </form>
  );
}

export function PolicyPage(props: PolicyPageProps) {
  return (
    <Layout title="Policy" signedIn={props.signedIn}>
      <h1>Your trading policy</h1>
      <p>
        Every order the AI proposes is checked against these rules, at proposal and again when you
        approve. The AI can read them but never change them. Version {props.version}.
      </p>
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
      <section class="box">
        <h2>Fixed rules</h2>
        <ul>
          <li>Security types: stocks and ETFs only.</li>
          <li>Order types: market and limit, each lasting for the day only.</li>
          <li>Every order needs your approval on this website. This can't be turned off.</li>
          <li>No short selling: you can never sell more than you hold.</li>
        </ul>
      </section>
    </Layout>
  );
}
