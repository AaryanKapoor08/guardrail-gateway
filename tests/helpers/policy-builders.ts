import { evaluate } from '../../src/policy/evaluate.js';
import { DEFAULT_POLICY, type PolicyRules } from '../../src/policy/schema.js';
import type { OrderRequest, PolicyContext, RuleId, RuleResult } from '../../src/policy/types.js';

// Defaults describe an order that passes every rule under the default policy: buy 1 ETF share
// at $96.40 CAD in an allowed account, in paper mode.

export function buildOrder(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return { side: 'buy', quantity: '1', orderType: 'market', mode: 'paper', ...overrides };
}

export function buildContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    killSwitch: false,
    userMode: 'paper',
    isDemoUser: false,
    account: { allowed: true, present: true, isPaper: false },
    connection: { disabled: false, type: 'read' },
    grantHasTradeScope: false,
    liveEnabled: false,
    livePaperOnly: true,
    security: { symbol: 'VFV.TO', typeCode: 'et', currency: 'CAD' },
    price: { value: '96.40', source: 'quote', asOf: new Date('2026-10-05T14:00:00Z') },
    heldQuantity: '0',
    openSellQuantity: '0',
    todayCountedValue: '0',
    todayCountedOrders: 0,
    hasOpenIntents: false,
    ...overrides,
  };
}

// A context where every live-trading gate passes.
export function buildLiveContext(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return buildContext({
    userMode: 'live',
    liveEnabled: true,
    grantHasTradeScope: true,
    connection: { disabled: false, type: 'trade' },
    account: { allowed: true, present: true, isPaper: true },
    ...overrides,
  });
}

export function buildPolicy(overrides: Partial<PolicyRules> = {}): PolicyRules {
  return { ...DEFAULT_POLICY, ...overrides };
}

export type Scenario = {
  readonly policy?: Partial<PolicyRules>;
  readonly order?: Partial<OrderRequest>;
  readonly context?: Partial<PolicyContext>;
  readonly live?: boolean;
};

// Evaluates the scenario and returns the result of one rule.
export function ruleResult(rule: RuleId, scenario: Scenario = {}): RuleResult {
  const context = scenario.live
    ? buildLiveContext(scenario.context)
    : buildContext(scenario.context);
  const order = buildOrder({ ...(scenario.live ? { mode: 'live' } : {}), ...scenario.order });
  const evaluation = evaluate(buildPolicy(scenario.policy), order, context);
  const result = evaluation.results.find((candidate) => candidate.rule === rule);
  if (result === undefined) {
    throw new Error(`rule ${rule} missing from evaluation`);
  }
  return result;
}
