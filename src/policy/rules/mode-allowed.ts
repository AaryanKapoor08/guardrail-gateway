import type { PolicyContext, RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// Every gate from V§10.3 that must hold for a live order, as plain-English problems.
export function liveTradingProblems(context: PolicyContext): string[] {
  const problems: string[] = [];
  if (context.isDemoUser) {
    problems.push("live mode isn't available in the demo");
  }
  if (!context.liveEnabled) {
    problems.push('live trading is turned off on this server');
  }
  if (!context.grantHasTradeScope) {
    problems.push("your SnapTrade sign-in doesn't include trading permission");
  }
  if (context.connection?.type !== 'trade' || context.connection.disabled) {
    problems.push("this account's brokerage connection isn't trade-enabled");
  }
  if (context.livePaperOnly && context.account?.isPaper !== true) {
    problems.push('this server only allows live orders on paper brokerage accounts');
  }
  return problems;
}

export function modeAllowed({ order, context }: RuleInput): RuleResult {
  // The mode is fixed on the intent when proposed, so an order can never silently switch from
  // paper to live between proposal and approval (V§6.5).
  if (order.mode !== context.userMode) {
    return fail(
      'mode_allowed',
      'Mode changed since this order was proposed. Ask the AI to propose again.',
    );
  }
  if (order.mode === 'paper') {
    return pass('mode_allowed', 'Paper mode: the order is simulated and no real order is placed.');
  }
  const problems = liveTradingProblems(context);
  if (problems.length > 0) {
    return fail('mode_allowed', `Live mode isn't available: ${problems.join('; ')}.`);
  }
  return pass('mode_allowed', 'Live mode: every live-trading safety check passes.');
}
