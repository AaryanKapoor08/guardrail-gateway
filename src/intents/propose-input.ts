import { z } from 'zod';
import { sha256Hex } from '../lib/crypto.js';
import { dec, decimalFromNumber, isPositive } from '../lib/money.js';
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

// What the AI believes about the order (the claim check). Every field is optional so older
// callers keep working, and every field has a hard length cap because a person reads it on the
// approval page. Free text is only ever shown as text, never as HTML.
export const AiReasoningSchema = z
  .object({
    why: z.string().trim().min(1).max(500).optional().describe('Why you are placing this order.'),
    expected_price: decimalInput
      .refine(isPositive, 'must be more than 0')
      .optional()
      .describe('The price per share you expect to pay or get, e.g. "180.50".'),
    company_name: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('The company or fund you believe the symbol is.'),
    user_request: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe("The user's own words that asked for this order."),
    sources: z
      .array(z.url({ protocol: /^https?$/ }).max(500))
      .max(5)
      .optional()
      .describe('Up to 5 web pages (http or https) you used for research.'),
  })
  .strict();

export type AiReasoning = z.infer<typeof AiReasoningSchema>;

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
    reasoning: AiReasoningSchema.optional(),
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
