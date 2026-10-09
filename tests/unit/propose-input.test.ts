import { describe, expect, it } from 'vitest';
import { ProposeOrderInputSchema } from '../../src/intents/propose-input.js';

const ORDER = {
  account_ref: 'acc_7Kq2x9Ab',
  symbol: 'AAPL',
  side: 'buy',
  quantity: 1,
  order_type: 'market',
};

function parseReasoning(reasoning: unknown) {
  return ProposeOrderInputSchema.safeParse({ ...ORDER, reasoning });
}

describe('the reasoning the AI sends with an order', () => {
  it('is optional, so older callers keep working', () => {
    expect(ProposeOrderInputSchema.safeParse(ORDER).success).toBe(true);
  });

  it('accepts every field and turns a numeric expected price into a decimal string', () => {
    const parsed = parseReasoning({
      why: 'The user wants to start a position.',
      expected_price: 180.5,
      company_name: 'Apple Inc.',
      user_request: 'buy one apple share',
      sources: ['https://example.com/aapl', 'http://news.example.org/a'],
    });

    expect(parsed.success && parsed.data.reasoning?.expected_price).toBe('180.5');
  });

  it.each([
    ['a reason over 500 characters', { why: 'x'.repeat(501) }],
    ['a company name over 120 characters', { company_name: 'x'.repeat(121) }],
    ["the user's words over 300 characters", { user_request: 'x'.repeat(301) }],
    ['an expected price of zero', { expected_price: '0' }],
    ['a negative expected price', { expected_price: '-5' }],
    ['more than 5 sources', { sources: Array.from({ length: 6 }, () => 'https://a.example') }],
    ['a source that is not a web page', { sources: ['javascript:alert(1)'] }],
    ['an unknown field', { confidence: 'high' }],
  ])('rejects %s', (_case, reasoning) => {
    expect(parseReasoning(reasoning).success).toBe(false);
  });
});
