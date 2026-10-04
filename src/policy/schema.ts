import { z } from 'zod';
import { cmp, decimalPlaces, isPositive } from '../lib/money.js';
import { ORDER_TYPES, SIDES } from './types.js';

// The user's rules (PRODUCT_VISION §8.2). Stored as JSON in `policies.rules` and parsed with this
// schema every time it is read, so a bad value can never reach the policy engine.

// Security type codes from SnapTrade's symbol search: `cs` = common stock, `et` = ETF.
export const ASSET_TYPES = ['cs', 'et'] as const;
export const POLICY_CURRENCIES = ['CAD', 'USD'] as const;
export type PolicyCurrency = (typeof POLICY_CURRENCIES)[number];

// Hard ceilings (V§8.2), so a typo in the policy editor can't become a disaster.
export const MAX_ORDER_VALUE_CEILING = '10000';
export const MAX_DAILY_VALUE_CEILING = '50000';
export const MAX_ORDERS_PER_DAY_CEILING = 50;
export const APPROVAL_WINDOW_MIN_MINUTES = 5;
export const APPROVAL_WINDOW_MAX_MINUTES = 30;

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
export const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,20}$/;

function moneyLimitSchema(ceiling: string) {
  return (
    z
      .string()
      .trim()
      // `abort` stops the later checks, which need a valid decimal string to work with.
      .regex(PLAIN_DECIMAL, { error: 'must be a plain number like 100 or 99.50', abort: true })
      .refine((value) => isPositive(value), 'must be more than 0')
      .refine((value) => decimalPlaces(value) <= 2, 'must have at most 2 decimal places')
      .refine((value) => cmp(value, ceiling) <= 0, `must be at most ${ceiling}`)
  );
}

const symbolSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(SYMBOL_PATTERN, 'must be 1-20 letters, digits, dots, or dashes'));

export const PolicyRulesSchema = z.object({
  allowedSides: z.array(z.enum(SIDES)).min(1),
  // Fixed in v1 and shown read-only; listed so the AI and the user can see them.
  assetTypes: z.array(z.enum(ASSET_TYPES)).min(1),
  orderTypes: z.array(z.enum(ORDER_TYPES)).min(1),
  maxOrderValue: moneyLimitSchema(MAX_ORDER_VALUE_CEILING),
  maxDailyValue: moneyLimitSchema(MAX_DAILY_VALUE_CEILING),
  maxOrdersPerDay: z.number().int().min(1).max(MAX_ORDERS_PER_DAY_CEILING),
  symbolAllowlist: z.array(symbolSchema),
  symbolDenylist: z.array(symbolSchema),
  policyCurrency: z.enum(POLICY_CURRENCIES),
  approvalWindowMinutes: z
    .number()
    .int()
    .min(APPROVAL_WINDOW_MIN_MINUTES)
    .max(APPROVAL_WINDOW_MAX_MINUTES),
  schemaVersion: z.literal(1),
});

export type PolicyRules = z.infer<typeof PolicyRulesSchema>;

// Strict by default: buys only, small limits, every order needs approval (V§4.1 step 5).
export const DEFAULT_POLICY: PolicyRules = {
  allowedSides: ['buy'],
  assetTypes: ['cs', 'et'],
  orderTypes: ['market', 'limit'],
  maxOrderValue: '100',
  maxDailyValue: '250',
  maxOrdersPerDay: 5,
  symbolAllowlist: [],
  symbolDenylist: [],
  policyCurrency: 'CAD',
  approvalWindowMinutes: 10,
  schemaVersion: 1,
};
