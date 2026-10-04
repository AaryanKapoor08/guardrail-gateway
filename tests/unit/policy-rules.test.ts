import { describe, expect, it } from 'vitest';
import type { RuleId } from '../../src/policy/types.js';
import { ruleResult, type Scenario } from '../helpers/policy-builders.js';

type Case = readonly [name: string, scenario: Scenario, expectedToPass: boolean];

function checkCases(rule: RuleId, cases: readonly Case[]): void {
  it.each(cases)('%s', (_name, scenario, expectedToPass) => {
    const result = ruleResult(rule, scenario);

    expect(result.passed).toBe(expectedToPass);
    expect(result.reason.length).toBeGreaterThan(10);
  });
}

describe('kill_switch_off', () => {
  checkCases('kill_switch_off', [
    ['passes when the kill switch is off', {}, true],
    ['fails when the kill switch is on', { context: { killSwitch: true } }, false],
  ]);
});

describe('connection_healthy', () => {
  checkCases('connection_healthy', [
    ['passes for a working connection', {}, true],
    [
      'fails for a broken connection',
      { context: { connection: { disabled: true, type: 'read' } } },
      false,
    ],
    ['fails when the connection is unknown', { context: { connection: null } }, false],
  ]);
});

describe('account_allowed', () => {
  checkCases('account_allowed', [
    ['passes for an allowed account', {}, true],
    [
      'fails for an account the user has not allowed',
      { context: { account: { allowed: false, present: true, isPaper: false } } },
      false,
    ],
    [
      'fails for an account no longer at SnapTrade',
      { context: { account: { allowed: true, present: false, isPaper: false } } },
      false,
    ],
    ['fails for an unknown account', { context: { account: null } }, false],
  ]);
});

describe('mode_allowed', () => {
  checkCases('mode_allowed', [
    ['passes in paper mode', {}, true],
    ['passes in live mode when every gate passes', { live: true }, true],
    ['fails when the mode changed since the proposal', { context: { userMode: 'live' } }, false],
    ['fails live for a demo user', { live: true, context: { isDemoUser: true } }, false],
    [
      'fails live when the server switch is off',
      { live: true, context: { liveEnabled: false } },
      false,
    ],
    [
      'fails live without the trade scope',
      { live: true, context: { grantHasTradeScope: false } },
      false,
    ],
    [
      'fails live on a read-only connection',
      { live: true, context: { connection: { disabled: false, type: 'read' } } },
      false,
    ],
    [
      'fails live on a broken trade connection',
      { live: true, context: { connection: { disabled: true, type: 'trade' } } },
      false,
    ],
    ['fails live with no known connection', { live: true, context: { connection: null } }, false],
    [
      'fails live on a real-money account when paper accounts only',
      { live: true, context: { account: { allowed: true, present: true, isPaper: false } } },
      false,
    ],
    [
      'fails live with no known account when paper accounts only',
      { live: true, context: { account: null } },
      false,
    ],
    [
      'passes live on a real-money account when the server allows it',
      {
        live: true,
        context: {
          livePaperOnly: false,
          account: { allowed: true, present: true, isPaper: false },
        },
      },
      true,
    ],
  ]);

  it('lists every failing live gate in one reason', () => {
    const result = ruleResult('mode_allowed', {
      live: true,
      context: { liveEnabled: false, grantHasTradeScope: false },
    });

    expect(result.reason).toBe(
      "Live mode isn't available: live trading is turned off on this server; your SnapTrade sign-in doesn't include trading permission.",
    );
  });

  it('explains a mode change in plain words', () => {
    expect(ruleResult('mode_allowed', { context: { userMode: 'live' } }).reason).toBe(
      'Mode changed since this order was proposed. Ask the AI to propose again.',
    );
  });
});

describe('side_allowed', () => {
  checkCases('side_allowed', [
    ['passes a buy under the default policy', {}, true],
    ['fails a sell under the default policy', { order: { side: 'sell' } }, false],
    [
      'passes a sell when the policy allows selling',
      { order: { side: 'sell' }, policy: { allowedSides: ['buy', 'sell'] } },
      true,
    ],
  ]);
});

describe('no_short_selling', () => {
  const sell = { side: 'sell' } as const;
  checkCases('no_short_selling', [
    ['passes a buy', {}, true],
    [
      'passes a sell covered by holdings',
      { order: { ...sell, quantity: '2' }, context: { heldQuantity: '5' } },
      true,
    ],
    [
      'passes a sell of exactly what is held minus open sells',
      { order: { ...sell, quantity: '3' }, context: { heldQuantity: '5', openSellQuantity: '2' } },
      true,
    ],
    [
      'fails a sell of more than held minus open sells',
      {
        order: { ...sell, quantity: '3.5' },
        context: { heldQuantity: '5', openSellQuantity: '2' },
      },
      false,
    ],
    ['fails a sell with nothing held', { order: { ...sell, quantity: '1' } }, false],
    [
      'skips (passes) a sell with an invalid quantity',
      { order: { ...sell, quantity: 'lots' } },
      true,
    ],
  ]);

  it('says how much can be sold', () => {
    const result = ruleResult('no_short_selling', {
      order: { side: 'sell', quantity: '4' },
      context: { heldQuantity: '5', openSellQuantity: '2' },
    });

    expect(result.reason).toBe(
      "You hold 5, with 2 already in other open sell orders, so you can sell at most 3. Short selling isn't allowed.",
    );
  });
});

describe('asset_type_allowed', () => {
  const security = (typeCode: string) => ({
    context: { security: { symbol: 'X', typeCode, currency: 'CAD' } },
  });
  checkCases('asset_type_allowed', [
    ['passes a common stock', security('cs'), true],
    ['passes an ETF', security('et'), true],
    ['fails a mutual fund (oef)', security('oef'), false],
    ['fails crypto', security('crypto'), false],
    ['fails an unlisted type code', security('zz'), false],
    ['fails an unknown security', { context: { security: null } }, false],
  ]);

  it('explains crypto in plain words', () => {
    expect(ruleResult('asset_type_allowed', security('crypto')).reason).toBe(
      "Crypto isn't allowed; only stocks and ETFs.",
    );
  });

  it('names an unlisted type code', () => {
    expect(ruleResult('asset_type_allowed', security('zz')).reason).toContain('Security type "zz"');
  });
});

describe('symbol_allowed', () => {
  checkCases('symbol_allowed', [
    ['passes any symbol when both lists are empty', {}, true],
    ['fails a symbol on the blocked list', { policy: { symbolDenylist: ['VFV.TO'] } }, false],
    [
      'passes a symbol on the allowed list',
      { policy: { symbolAllowlist: ['VFV.TO', 'XEQT.TO'] } },
      true,
    ],
    [
      'fails a symbol missing from a non-empty allowed list',
      { policy: { symbolAllowlist: ['XEQT.TO'] } },
      false,
    ],
    [
      'fails a symbol on both lists (blocked wins)',
      { policy: { symbolAllowlist: ['VFV.TO'], symbolDenylist: ['VFV.TO'] } },
      false,
    ],
    ['fails an unknown security', { context: { security: null } }, false],
  ]);
});

describe('order_type_allowed', () => {
  checkCases('order_type_allowed', [
    ['passes a market order', {}, true],
    [
      'passes a limit order with a price',
      { order: { orderType: 'limit', limitPrice: '95' } },
      true,
    ],
    ['fails a limit order without a price', { order: { orderType: 'limit' } }, false],
    ['fails a limit order priced at 0', { order: { orderType: 'limit', limitPrice: '0' } }, false],
    [
      'fails a limit order priced with text',
      { order: { orderType: 'limit', limitPrice: 'cheap' } },
      false,
    ],
    [
      'fails an order type the policy does not allow',
      { order: { orderType: 'limit', limitPrice: '95' }, policy: { orderTypes: ['market'] } },
      false,
    ],
  ]);
});

describe('quantity_valid', () => {
  checkCases('quantity_valid', [
    ['passes a whole quantity', {}, true],
    ['passes 6 decimal places in paper', { order: { quantity: '0.123456' } }, true],
    ['fails 7 decimal places', { order: { quantity: '0.1234567' } }, false],
    ['fails zero', { order: { quantity: '0' } }, false],
    ['fails a negative quantity', { order: { quantity: '-1' } }, false],
    ['fails text', { order: { quantity: 'ten' } }, false],
    ['passes a fractional quantity in paper', { order: { quantity: '0.5' } }, true],
    ['fails a fractional quantity in live', { live: true, order: { quantity: '0.5' } }, false],
    [
      'passes a whole quantity written with zeros in live',
      { live: true, order: { quantity: '2.000' } },
      true,
    ],
  ]);
});

describe('currency_supported', () => {
  checkCases('currency_supported', [
    ['passes a security in the policy currency', {}, true],
    [
      'fails a security in another currency',
      { context: { security: { symbol: 'AAPL', typeCode: 'cs', currency: 'USD' } } },
      false,
    ],
    ['fails an unknown security', { context: { security: null } }, false],
  ]);
});

describe('price_available', () => {
  const asOf = new Date('2026-10-05T14:00:00Z');
  checkCases('price_available', [
    ['passes with a quote', {}, true],
    [
      'passes with a limit price',
      { context: { price: { value: '95', source: 'limit', asOf: null } } },
      true,
    ],
    [
      'passes with a position price',
      { context: { price: { value: '95', source: 'position', asOf } } },
      true,
    ],
    ['fails with no price', { context: { price: null } }, false],
    ['fails with no price and no security', { context: { price: null, security: null } }, false],
    ['passes with a price but no security', { context: { security: null } }, true],
  ]);

  it('labels where the price came from', () => {
    expect(ruleResult('price_available').reason).toBe(
      "Estimated price $96.40 CAD, from the broker's latest quote (may be delayed).",
    );
  });
});

describe('max_order_value', () => {
  const priced = (value: string) =>
    ({ context: { price: { value, source: 'quote', asOf: null } } }) as const;
  checkCases('max_order_value', [
    ['passes a value exactly at the limit', priced('100.00'), true],
    ['fails a value one cent over the limit', priced('100.01'), false],
    ['skips (passes) when there is no price', { context: { price: null } }, true],
  ]);

  it('explains a pass and a failure with formatted money', () => {
    expect(ruleResult('max_order_value').reason).toBe(
      'Order value $96.40 CAD is within your per-order limit of $100.00 CAD.',
    );
    expect(ruleResult('max_order_value', priced('340')).reason).toBe(
      'Order value $340.00 CAD exceeds your per-order limit of $100.00 CAD.',
    );
  });
});

describe('max_daily_value', () => {
  const price100 = { value: '100', source: 'quote', asOf: null } as const;
  checkCases('max_daily_value', [
    [
      'passes when today plus this order is exactly the limit',
      { context: { price: price100, todayCountedValue: '150' } },
      true,
    ],
    [
      'fails one cent over the limit',
      { context: { price: price100, todayCountedValue: '150.01' } },
      false,
    ],
    [
      'skips (passes) when there is no price',
      { context: { price: null, todayCountedValue: '1000' } },
      true,
    ],
  ]);
});

describe('max_orders_per_day', () => {
  checkCases('max_orders_per_day', [
    ['passes the last order allowed today', { context: { todayCountedOrders: 4 } }, true],
    ['fails once the daily count is used up', { context: { todayCountedOrders: 5 } }, false],
  ]);
});

describe('approval_required', () => {
  checkCases('approval_required', [
    ['always passes', {}, true],
    [
      'passes even when everything else fails',
      { context: { killSwitch: true, account: null } },
      true,
    ],
  ]);
});
