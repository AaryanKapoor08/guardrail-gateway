import { describe, expect, it } from 'vitest';
import { type BrokerFacts, checkClaims } from '../../src/claims/check-claims.js';

function buildBroker(overrides: Partial<BrokerFacts> = {}): BrokerFacts {
  return {
    symbol: 'AAPL',
    securityName: 'Apple Inc.',
    price: '180.50',
    currency: 'USD',
    ...overrides,
  };
}

describe('checkClaims with no reasoning', () => {
  it.each([
    ['no reasoning object at all', undefined],
    ['an empty reasoning object', {}],
  ])('tells the human the AI gave no reasons when it sent %s', (_case, reasoning) => {
    expect(checkClaims(reasoning, buildBroker())).toEqual([
      {
        claim: 'reasoning',
        status: 'missing',
        message: 'The AI gave no reasons for this order.',
      },
    ]);
  });

  it('checks nothing when the AI explained itself but named no price or company', () => {
    expect(checkClaims({ why: 'Long-term holding.' }, buildBroker())).toEqual([]);
  });
});

describe('checkClaims on the expected price', () => {
  it.each([
    ['an exact match', '180.50', 'matches'],
    ['a price 5% above the broker price', '189.525', 'matches'],
    ['a price 5% below the broker price', '171.475', 'matches'],
    ['a price just over 5% above', '189.53', 'differs'],
    ['a price just over 5% below', '171.47', 'differs'],
    ['a price far above', '330', 'differs'],
  ])('reports %s as %s', (_case, expectedPrice, status) => {
    const [result] = checkClaims({ expected_price: expectedPrice }, buildBroker());

    expect(result).toMatchObject({
      claim: 'price',
      status,
      aiSaid: expectedPrice,
      brokerSays: '180.50',
    });
  });

  it('says how far off the AI was, in plain English, when the price differs', () => {
    const [result] = checkClaims({ expected_price: '330' }, buildBroker());

    expect(result?.message).toBe(
      "The AI expected about $330.00 USD a share, but your broker's latest price is $180.50 USD (45% lower).",
    );
  });

  it('says "higher" when the broker price is above what the AI expected', () => {
    const [result] = checkClaims({ expected_price: '100' }, buildBroker());

    expect(result?.message).toBe(
      "The AI expected about $100.00 USD a share, but your broker's latest price is $180.50 USD (81% higher).",
    );
  });

  it('confirms a matching price in plain English', () => {
    const [result] = checkClaims({ expected_price: '181' }, buildBroker());

    expect(result?.message).toBe(
      "The AI expected about $181.00 USD a share, and your broker's latest price is $180.50 USD (within 5%).",
    );
  });

  it('cannot check the price when the broker has none', () => {
    const [result] = checkClaims({ expected_price: '330' }, buildBroker({ price: null }));

    expect(result).toEqual({
      claim: 'price',
      status: 'cannot_check',
      aiSaid: '330',
      brokerSays: null,
      message:
        'The AI expected about $330.00 USD a share, but your broker has no current price to compare it with.',
    });
  });
});

describe('checkClaims on the company name', () => {
  it.each([
    ['the same name', 'Apple Inc.', 'Apple Inc.', 'matches'],
    ['a name without the suffix', 'apple', 'Apple Inc.', 'matches'],
    ['a fund described differently', 'iShares All-Equity', 'iShares Core Equity ETF', 'matches'],
    ['a different company', 'Microsoft', 'Apple Inc.', 'differs'],
    ['only filler words in common', 'The Common Stock Fund Inc.', 'Apple Inc. Class A', 'differs'],
  ])('reports %s as %s', (_case, aiName, brokerName, status) => {
    const [result] = checkClaims(
      { company_name: aiName },
      buildBroker({ securityName: brokerName }),
    );

    expect(result).toMatchObject({
      claim: 'company',
      status,
      aiSaid: aiName,
      brokerSays: brokerName,
    });
  });

  it('warns the human when the AI has the wrong company for the symbol', () => {
    const [result] = checkClaims(
      { company_name: 'Apple Inc.' },
      buildBroker({ symbol: 'APLE', securityName: 'Hospitality Properties REIT' }),
    );

    expect(result?.message).toBe(
      'The AI thinks APLE is "Apple Inc.", but your broker lists it as "Hospitality Properties REIT". Make sure this is the company you meant.',
    );
  });

  it('cannot check the company when the broker gave no name', () => {
    const [result] = checkClaims(
      { company_name: 'Apple Inc.' },
      buildBroker({ securityName: null }),
    );

    expect(result).toEqual({
      claim: 'company',
      status: 'cannot_check',
      aiSaid: 'Apple Inc.',
      brokerSays: null,
      message:
        'The AI said AAPL is "Apple Inc.", but your broker gave no company name to compare it with.',
    });
  });
});

describe('checkClaims with several claims', () => {
  it('checks the price first, then the company', () => {
    const results = checkClaims(
      { expected_price: '330', company_name: 'Apple', why: 'The user asked for it.' },
      buildBroker(),
    );

    expect(results.map((result) => [result.claim, result.status])).toEqual([
      ['price', 'differs'],
      ['company', 'matches'],
    ]);
  });
});
