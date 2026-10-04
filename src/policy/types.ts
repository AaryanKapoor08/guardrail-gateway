// Fixed sets shared by the policy engine, the intent service, and the database schema.
// They live here (not in src/db) so the pure policy code never imports database modules.

export const SIDES = ['buy', 'sell'] as const;
export type Side = (typeof SIDES)[number];

export const ORDER_TYPES = ['market', 'limit'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const MODES = ['paper', 'live'] as const;
export type Mode = (typeof MODES)[number];
