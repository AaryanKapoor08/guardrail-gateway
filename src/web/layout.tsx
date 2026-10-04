import type { Child } from 'hono/jsx';
import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';

type LayoutProps = {
  readonly title: string;
  readonly signedIn?: SignedIn | undefined;
  readonly children?: Child;
};

function SignedInNav(props: { signedIn: SignedIn }) {
  const { user } = props.signedIn;
  return (
    <nav>
      {user.mode === 'live' ? (
        <span class="badge live">LIVE mode</span>
      ) : (
        <span class="badge">Paper mode</span>
      )}
      <a href="/dashboard">Dashboard</a>
      <a href="/intents">Orders</a>
      <a href="/policy">Policy</a>
      <a href="/audit">Audit log</a>
      <a href="/apps">AI apps</a>
      <form method="post" action="/logout" class="inline">
        <CsrfField token={props.signedIn.session.csrfToken} />
        <button type="submit" class="link">
          Sign out
        </button>
      </form>
    </nav>
  );
}

// Every page: the same header, the same "not financial advice" footer, and no client-side
// JavaScript at all (the CSP forbids scripts anyway).
export function Layout(props: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · Guardrail Gateway`}</title>
        <link rel="stylesheet" href="/static/styles.css" />
      </head>
      <body>
        <header>
          <a href="/" class="brand">
            Guardrail Gateway
          </a>
          {props.signedIn === undefined ? null : <SignedInNav signedIn={props.signedIn} />}
        </header>
        {props.signedIn?.user.isDemo === true ? (
          <div class="demo-banner">
            DEMO DATA, not a real brokerage. This demo account and everything in it is deleted 24
            hours after it was created. <a href="/try">Guided demo</a>
          </div>
        ) : null}
        {props.signedIn?.user.killSwitch === true ? (
          <div class="kill-switch-on">
            Kill switch is ON: every order the AI proposes is refused.{' '}
            <a href="/dashboard#kill-switch">Turn it off on the dashboard</a>
          </div>
        ) : null}
        <main>{props.children}</main>
        <footer>
          <p>Not financial advice. Guardrail Gateway never recommends trades.</p>
          <p>
            <a href="/privacy">Privacy</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
