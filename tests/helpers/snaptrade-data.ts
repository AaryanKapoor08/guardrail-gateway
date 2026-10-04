// Builders for SnapTrade-shaped JSON (field names from SnapTrade's API reference), used by the
// fake SnapTrade. Only fields our schemas read matter; a few extra ones keep the shape realistic.

export const SANDBOX_CONNECTION_ID = '87b24961-b51e-4db8-9226-f198f6518a89';
export const TFSA_ACCOUNT_ID = '917c8734-8470-4a3e-a18f-57c3f2ee6631';
export const MARGIN_ACCOUNT_ID = '2bcd7cc3-e922-4976-bce1-9858296801c3';

export type FakeConnection = {
  id: string;
  brokerage: { name: string; slug: string };
  name: string;
  type: string;
  disabled: boolean;
  disabled_date: string | null;
};

export type FakeAccount = {
  id: string;
  brokerage_authorization: string;
  name: string | null;
  number: string;
  institution_name: string;
  raw_type: string | null;
  account_category: string | null;
  is_paper: boolean;
  status: string | null;
  balance: { total: { amount: number; currency: string } };
};

export function buildConnection(overrides: Partial<FakeConnection> = {}): FakeConnection {
  return {
    id: SANDBOX_CONNECTION_ID,
    brokerage: { name: 'SnapTrade Sandbox', slug: 'SANDBOX' },
    name: 'Connection-1',
    type: 'read',
    disabled: false,
    disabled_date: null,
    ...overrides,
  };
}

export function buildAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    id: TFSA_ACCOUNT_ID,
    brokerage_authorization: SANDBOX_CONNECTION_ID,
    name: 'Sandbox TFSA',
    number: 'Q6542138443',
    institution_name: 'SnapTrade Sandbox',
    raw_type: 'TFSA',
    account_category: 'INVESTMENT',
    is_paper: false,
    status: 'open',
    balance: { total: { amount: 1000, currency: 'CAD' } },
    ...overrides,
  };
}

export type FakeBrokerage = {
  connections: FakeConnection[];
  accounts: FakeAccount[];
};

// One read-only Sandbox connection with a TFSA and a margin account.
export function buildDefaultBrokerage(): FakeBrokerage {
  return {
    connections: [buildConnection()],
    accounts: [
      buildAccount(),
      buildAccount({
        id: MARGIN_ACCOUNT_ID,
        name: 'Sandbox Margin',
        number: 'M0000009876',
        raw_type: 'Margin',
      }),
    ],
  };
}
