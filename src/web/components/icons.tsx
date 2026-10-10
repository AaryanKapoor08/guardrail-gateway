import type { Child } from 'hono/jsx';

// Hand-drawn line icons (24×24, round strokes) so the app needs no icon library. They are
// decorative: every icon sits next to a text label, so screen readers skip them.

function Icon(props: { children: Child }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export function DashboardIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function OrdersIcon() {
  return (
    <Icon>
      <path d="M6 3.5h12a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2-2-1.3V4.5a1 1 0 0 1 1-1Z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h3" />
    </Icon>
  );
}

export function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  );
}

export function AuditIcon() {
  return (
    <Icon>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function AppsIcon() {
  return (
    <Icon>
      <path d="M9 3.5v4M15 3.5v4" />
      <path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0V7.5Z" />
      <path d="M12 16.5v4" />
    </Icon>
  );
}

export function PlayIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m10 8.8 5 3.2-5 3.2V8.8Z" />
    </Icon>
  );
}

export function LockIcon() {
  return (
    <Icon>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Icon>
  );
}

export function TrashIcon() {
  return (
    <Icon>
      <path d="M4 6.5h16M9.5 6.5V4.5h5v2" />
      <path d="M6 6.5 7 20h10l1-13.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </Icon>
  );
}

export function SignOutIcon() {
  return (
    <Icon>
      <path d="M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </Icon>
  );
}

export function SearchIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

export function BellIcon() {
  return (
    <Icon>
      <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  );
}

export function ChevronDownIcon() {
  return (
    <Icon>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </Icon>
  );
}

export function SidebarIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9.5 4v16" />
      <path d="m15.5 10-2 2 2 2" />
    </Icon>
  );
}

export function PlusCircleIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </Icon>
  );
}

export function PowerIcon() {
  return (
    <Icon>
      <path d="M12 3.5v8" />
      <path d="M7 6.5a7.5 7.5 0 1 0 10 0" />
    </Icon>
  );
}

export function FlaskIcon() {
  return (
    <Icon>
      <path d="M9.5 3.5h5M10.5 3.5v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5.5-9.5v-6" />
      <path d="M7.5 15h9" />
    </Icon>
  );
}

export function WalletIcon() {
  return (
    <Icon>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="8" width="16" height="11.5" rx="2" />
      <path d="M16 13.8h1" />
    </Icon>
  );
}

export function ClockIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function SparklesIcon() {
  return (
    <Icon>
      <path d="M10 4.5 11.6 9 16 10.5 11.6 12 10 16.5 8.4 12 4 10.5 8.4 9 10 4.5Z" />
      <path d="M17.5 3.5v4M15.5 5.5h4M17 15.5v3M15.5 17h3" />
    </Icon>
  );
}

export function DotsIcon() {
  return (
    <Icon>
      <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="3" />
    </Icon>
  );
}

export function ArrowRightIcon() {
  return (
    <Icon>
      <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
    </Icon>
  );
}
