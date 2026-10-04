import { z } from 'zod';
import { sha256Hex } from '../lib/crypto.js';
import { dec, decimalFromNumber } from '../lib/money.js';
import { ORDER_TYPES, SIDES } from '../policy/types.js';

// The one input schema for proposing an order. The MCP `propose_order` tool, the "Try it without
// an AI" form, and the guided demo all use it, so their validation can never differ (P14).
// Field names are snake_case because this is the shape the AI sends.

const UNSIGNED_DECIMAL = /^\d+(\.\d+)?$/;

// The AI may send 1.5 or "1.5". Numbers are converted to decimal strings straight away, so no
// float maths ever happens on a quantity or price.
const decimalInput = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? decimalFromNumber(value) : value.trim()))
  .pipe(z.string().regex(UNSIGNED_DECIMAL, 'must be a positive number like 2 or 0.5'));

export const ProposeOrderInputSchema = z
  .object({
    account_ref: z
      .string()
      .regex(
        /^acc_[A-Za-z0-9_-]+$/,
        'must be an account_ref from list_accounts, like acc_7Kq2x9Ab',
      ),
    symbol: z.string().trim().min(1).max(20),
    side: z.enum(SIDES),
    quantity: decimalInput,
    order_type: z.enum(ORDER_TYPES),
    limit_price: decimalInput.optional(),
    idempotency_key: z.uuid().optional(),
  })
  .strict();

export type ProposeOrderInput = z.infer<typeof ProposeOrderInputSchema>;

// The same order written differently ("1.50" vs "1.5", "vfv.to" vs "VFV.TO") has the same
// fingerprint. Used for idempotency keys and the duplicate warning (V§8.4).
export function orderFingerprint(input: ProposeOrderInput): string {
  const parts = [
    input.account_ref,
    input.symbol.toUpperCase(),
    input.side,
    dec(input.quantity).toFixed(),
    input.order_type,
    input.limit_price === undefined ? null : dec(input.limit_price).toFixed(),
  ];
  return sha256Hex(JSON.stringify(parts));
}

// A readable summary of the first problem, e.g. "quantity: must be a positive number like 2".
export function describeInputProblem(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) {
    return 'The order details are invalid.';
  }
  const field = issue.path.join('.') || 'input';
  return issue.code === 'unrecognized_keys'
    ? `Unexpected field(s): ${issue.keys.join(', ')}.`
    : `${field}: ${issue.message}`;
}
