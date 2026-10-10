import type { Child } from 'hono/jsx';
import { CsrfField } from '../auth/csrf.js';
import type { SignedIn } from '../auth/sessions.js';
import {
  AppsIcon,
  AuditIcon,
  BellIcon,
  ChevronDownIcon,
  DashboardIcon,
  LockIcon,
  OrdersIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
  SidebarIcon,
  SignOutIcon,
  TrashIcon,
} from './components/icons.js';

// The sidebar entry to highlight. Pages outside the sidebar (consent, errors) leave it out.
export type ActivePage = 'dashboard' | 'orders' | 'policy' | 'audit' | 'apps' | 'demo';

type LayoutProps = {
  readonly title: string;
  readonly signedIn?: SignedIn | undefined;
  readonly activePage?: ActivePage | undefined;
  // Shown as a badge on the bell. Only pages that already loaded the count pass it.
  readonly waitingCount?: number | undefined;
  readonly children?: Child;
};

function Brand() {
  return (
    <a href="/" class="brand">
      <span class="brand-mark">
        <ShieldIcon />
      </span>
      <span>
        Guardrail <span class="brand-accent">Gateway</span>
      </span>
    </a>
  );
}

function SignOutForm(props: { csrfToken: string; className: string }) {
  return (
    <form method="post" action="/logout" class="inline">
      <CsrfField token={props.csrfToken} />
      <button type="submit" class={props.className}>
        <SignOutIcon />
        <span class="nav-text">Sign out</span>
      </button>
    </form>
  );
}

function NavLink(props: {
  href: string;
  label: string;
  icon: Child;
  page: ActivePage;
  activePage: ActivePage | undefined;
}) {
  const isActive = props.page === props.activePage;
  return (
    <li>
      <a
        href={props.href}
        class={isActive ? 'nav-link active' : 'nav-link'}
        aria-current={isActive ? 'page' : undefined}
        title={props.label}
      >
        {props.icon}
        <span class="nav-text">{props.label}</span>
      </a>
    </li>
  );
}

function StatusBlock(props: { signedIn: SignedIn }) {
  const { user } = props.signedIn;
  return (
    <div class="nav-status">
      <a href="/dashboard#mode" class="status-row">
        <span class="nav-text">Mode</span>
        {user.mode === 'live' ? (
          <span class="badge live">LIVE mode</span>
        ) : (
          <span class="badge">Paper mode</span>
        )}
      </a>
      <a href="/dashboard#kill-switch" class="status-row">
        <span class="nav-text">Kill switch</span>
        <span class={user.killSwitch ? 'pill bad' : 'pill ok'}>
          {user.killSwitch ? 'On' : 'Off'}
        </span>
      </a>
    </div>
  );
}

function Sidebar(props: { signedIn: SignedIn; activePage: ActivePage | undefined }) {
  const { activePage } = props;
  return (
    <nav class="sidebar" aria-label="Main">
      <ul class="nav-list">
        <NavLink
          href="/dashboard"
          label="Dashboard"
          icon={<DashboardIcon />}
          page="dashboard"
          activePage={activePage}
        />
        <NavLink
          href="/intents"
          label="Orders"
          icon={<OrdersIcon />}
          page="orders"
          activePage={activePage}
        />
        <NavLink
          href="/policy"
          label="Policy"
          icon={<ShieldIcon />}
          page="policy"
          activePage={activePage}
        />
        <NavLink
          href="/audit"
          label="Audit log"
          icon={<AuditIcon />}
          page="audit"
          activePage={activePage}
        />
        <NavLink
          href="/apps"
          label="AI apps"
          icon={<AppsIcon />}
          page="apps"
          activePage={activePage}
        />
        {props.signedIn.user.isDemo ? (
          <NavLink
            href="/try"
            label="Guided demo"
            icon={<PlayIcon />}
            page="demo"
            activePage={activePage}
          />
        ) : null}
      </ul>
      <hr class="nav-divider" />
      <StatusBlock signedIn={props.signedIn} />
      <ul class="nav-list nav-bottom">
        <li>
          <a href="/privacy" class="nav-link" title="Privacy">
            <LockIcon />
            <span class="nav-text">Privacy</span>
          </a>
        </li>
        <li>
          <a href="/account/delete" class="nav-link" title="Delete account">
            <TrashIcon />
            <span class="nav-text">Delete account</span>
          </a>
        </li>
        <li>
          <SignOutForm csrfToken={props.signedIn.session.csrfToken} className="nav-link" />
        </li>
      </ul>
    </nav>
  );
}

function initialOf(signedIn: SignedIn): string {
  const first = signedIn.user.email?.trim().charAt(0).toUpperCase() ?? '';
  if (first !== '') {
    return first;
  }
  return signedIn.user.isDemo ? 'D' : 'U';
}

// The avatar menu opens with <details>, so it works without JavaScript.
function UserMenu(props: { signedIn: SignedIn }) {
  const { user } = props.signedIn;
  return (
    <details class="user-menu">
      <summary>
        <span class="avatar">{initialOf(props.signedIn)}</span>
        <ChevronDownIcon />
        <span class="sr-only">Account menu</span>
      </summary>
      <div class="menu">
        <p class="menu-head">
          {user.isDemo ? 'Demo account' : (user.email ?? 'Signed in with SnapTrade')}
        </p>
        <a href="/privacy">Privacy</a>
        <a href="/account/delete">Delete account</a>
        <SignOutForm csrfToken={props.signedIn.session.csrfToken} className="menu-item" />
      </div>
    </details>
  );
}

function SignedInTopbar(props: { signedIn: SignedIn; waitingCount: number | undefined }) {
  const count = props.waitingCount ?? 0;
  return (
    <header class="topbar">
      <div class="topbar-start">
        <Brand />
        <label for="sidebar-toggle" class="collapse-button" title="Collapse or expand the menu">
          <SidebarIcon />
          <span class="sr-only">Collapse or expand the menu</span>
        </label>
      </div>
      <search class="search">
        <form method="get" action="/intents">
          <SearchIcon />
          <label for="search-symbol" class="sr-only">
            Search orders by symbol
          </label>
          <input id="search-symbol" name="symbol" placeholder="Search orders by symbol…" />
        </form>
      </search>
      <div class="topbar-end">
        <a href="/dashboard#pending" class="icon-button" title="Orders waiting for you">
          <BellIcon />
          {count > 0 ? <span class="count-badge">{String(count)}</span> : null}
          <span class="sr-only">Orders waiting for you</span>
        </a>
        <UserMenu signedIn={props.signedIn} />
      </div>
    </header>
  );
}

function SignedOutTopbar() {
  return (
    <header class="topbar">
      <div class="topbar-start">
        <Brand />
      </div>
      <div class="topbar-end">
        <a href="/signin" class="button">
          Sign in
        </a>
      </div>
    </header>
  );
}

function TopBanners(props: { signedIn: SignedIn | undefined }) {
  return (
    <>
      {props.signedIn?.user.isDemo === true ? (
        <div class="top-banner demo-banner">
          DEMO DATA, not a real brokerage. This demo account and everything in it is deleted 24
          hours after it was created. <a href="/try">Guided demo</a>
        </div>
      ) : null}
      {props.signedIn?.user.killSwitch === true ? (
        <div class="top-banner kill-switch-on">
          Kill switch is ON: every order the AI proposes is refused.{' '}
          <a href="/dashboard#kill-switch">Turn it off on the dashboard</a>
        </div>
      ) : null}
    </>
  );
}

function Footer() {
  return (
    <footer>
      <p>Not financial advice. Guardrail Gateway never recommends trades.</p>
      <p>
        Built on <a href="https://snaptrade.com">SnapTrade</a> · <a href="/privacy">Privacy</a>
      </p>
    </footer>
  );
}

function Shell(props: LayoutProps & { signedIn: SignedIn }) {
  return (
    <>
      <input type="checkbox" id="sidebar-toggle" class="sidebar-toggle" />
      <SignedInTopbar signedIn={props.signedIn} waitingCount={props.waitingCount} />
      <div class="shell">
        <Sidebar signedIn={props.signedIn} activePage={props.activePage} />
        <main class="main">
          <TopBanners signedIn={props.signedIn} />
          {props.children}
          <Footer />
        </main>
      </div>
    </>
  );
}

// Every page: the same top bar, the sidebar once signed in, the same "not financial advice"
// footer, and no client-side JavaScript at all (the CSP forbids scripts anyway).
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
        {props.signedIn === undefined ? (
          <>
            <SignedOutTopbar />
            <main class="main public">
              {props.children}
              <Footer />
            </main>
          </>
        ) : (
          <Shell {...props} signedIn={props.signedIn} />
        )}
      </body>
    </html>
  );
}
