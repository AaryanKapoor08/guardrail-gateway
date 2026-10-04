import type { PolicyRules } from './schema.js';

// Shapes the pure policy engine works with (PRODUCT_VISION §8). The fixed sets also live here
// (not in src/db) so the policy code never imports database modules.

export const SIDES = ['buy', 'sell'] as const;
export type Side = (typeof SIDES)[number];

export const ORDER_TYPES = ['market', 'limit'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const MODES = ['paper', 'live'] as const;
export type Mode = (typeof MODES)[number];

export const PRICE_SOURCES = ['quote', 'limit', 'position'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

// What the AI (or the user) asked for. Quantities and prices are decimal strings.
export type OrderRequest = {
  readonly side: Side;
  readonly quantity: string;
  readonly orderType: OrderType;
  readonly limitPrice?: string | undefined;
  // The mode captured on the intent when it was proposed.
  readonly mode: Mode;
};

// Everything the rules need, fetched before evaluation so the rules themselves do no I/O.
export type PolicyContext = {
  readonly killSwitch: boolean;
  readonly userMode: Mode;
  readonly isDemoUser: boolean;
  readonly account: {
    readonly allowed: boolean;
    readonly present: boolean;
    readonly isPaper: boolean;
  } | null;
  readonly connection: { readonly disabled: boolean; readonly type: 'read' | 'trade' } | null;
  readonly grantHasTradeScope: boolean;
  // Server switches: LIVE_TRADING_ENABLED and LIVE_TRADING_PAPER_ACCOUNTS_ONLY.
  readonly liveEnabled: boolean;
  readonly livePaperOnly: boolean;
  readonly security: {
    readonly symbol: string;
    readonly typeCode: string;
    readonly currency: string;
  } | null;
  readonly price: {
    readonly value: string;
    readonly source: PriceSource;
    readonly asOf: Date | null;
  } | null;
  // For sells: how much the user holds, and how much is already in other open sell intents.
  readonly heldQuantity: string;
  readonly openSellQuantity: string;
  // Today (America/Toronto) so far, not counting the intent being evaluated.
  readonly todayCountedValue: string;
  readonly todayCountedOrders: number;
  readonly hasOpenIntents: boolean;
};

// In the order of V§8.2.
export const RULE_IDS = [
  'kill_switch_off',
  'connection_healthy',
  'account_allowed',
  'mode_allowed',
  'side_allowed',
  'no_short_selling',
  'asset_type_allowed',
  'symbol_allowed',
  'order_type_allowed',
  'quantity_valid',
  'currency_supported',
  'price_available',
  'max_order_value',
  'max_daily_value',
  'max_orders_per_day',
  'approval_required',
] as const;
export type RuleId = (typeof RULE_IDS)[number];

// `reason` is plain English for both outcomes; it goes to the AI, the approval page, and the
// audit log.
export type RuleResult = {
  readonly rule: RuleId;
  readonly passed: boolean;
  readonly reason: string;
};

// What every rule function receives. `estimatedValue` is quantity × price rounded to cents, or
// null when there is no usable price or quantity.
export type RuleInput = {
  readonly policy: PolicyRules;
  readonly order: OrderRequest;
  readonly context: PolicyContext;
  readonly estimatedValue: string | null;
};

export type Rule = (input: RuleInput) => RuleResult;
