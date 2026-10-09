import Big from 'big.js';
import { z } from 'zod';
import type { AiReasoning } from '../intents/propose-input.js';
import { cmp, dec, fmtMoney, isPositive } from '../lib/money.js';

// The claim check: compares what the AI believes about an order (its expected price, which
// company it thinks the symbol is) with the broker's own data, so the human sees any
// disagreement before approving. Pure: no I/O. The results are information for the human and
// the AI only; they never change the policy decision.

export const CLAIM_STATUSES = ['matches', 'differs', 'cannot_check'] as const;

const checkedClaimFields = {
  status: z.enum(CLAIM_STATUSES),
  aiSaid: z.string(),
  brokerSays: z.string().nullable(),
  message: z.string(),
};

export const ClaimResultSchema = z.discriminatedUnion('claim', [
  z.object({ claim: z.literal('price'), ...checkedClaimFields }),
  z.object({ claim: z.literal('company'), ...checkedClaimFields }),
  z.object({ claim: z.literal('reasoning'), status: z.literal('missing'), message: z.string() }),
]);

export type ClaimResult = z.infer<typeof ClaimResultSchema>;

export type BrokerFacts = {
  readonly symbol: string;
  // The security's full name from the broker's symbol lookup, when it gave one.
  readonly securityName: string | null;
  // The broker's latest market price per share (quote, or position price as a fallback).
  readonly price: string | null;
  readonly currency: string;
};

export const NO_REASONING_MESSAGE = 'The AI gave no reasons for this order.';

// Prices move during the day and the AI's research may be minutes old, so small gaps are normal.
const PRICE_TOLERANCE = '0.05';

// Words that appear in many security names and say nothing about which company it is.
const FILLER_WORDS = new Set([
  'and',
  'class',
  'co',
  'common',
  'company',
  'corp',
  'corporation',
  'etf',
  'fund',
  'inc',
  'incorporated',
  'limited',
  'ltd',
  'of',
  'plc',
  'share',
  'shares',
  'stock',
  'the',
]);

function hasAnyReasoning(reasoning: AiReasoning): boolean {
  return Object.values(reasoning).some((value) => value !== undefined);
}

function checkPrice(expectedPrice: string, broker: BrokerFacts): ClaimResult {
  const aiPrice = fmtMoney(expectedPrice, broker.currency);
  const expectation = `The AI expected about ${aiPrice} a share`;
  if (broker.price === null || !isPositive(broker.price)) {
    return {
      claim: 'price',
      status: 'cannot_check',
      aiSaid: expectedPrice,
      brokerSays: null,
      message: `${expectation}, but your broker has no current price to compare it with.`,
    };
  }
  const brokerPrice = fmtMoney(broker.price, broker.currency);
  const gap = dec(expectedPrice).minus(dec(broker.price)).abs();
  if (!gap.div(dec(broker.price)).gt(PRICE_TOLERANCE)) {
    return {
      claim: 'price',
      status: 'matches',
      aiSaid: expectedPrice,
      brokerSays: broker.price,
      message: `${expectation}, and your broker's latest price is ${brokerPrice} (within 5%).`,
    };
  }
  // Said relative to the AI's figure: "45% lower" than what the AI expected.
  const percent = gap.div(dec(expectedPrice)).times(100).round(0, Big.roundHalfUp).toFixed();
  const direction = cmp(broker.price, expectedPrice) < 0 ? 'lower' : 'higher';
  return {
    claim: 'price',
    status: 'differs',
    aiSaid: expectedPrice,
    brokerSays: broker.price,
    message: `${expectation}, but your broker's latest price is ${brokerPrice} (${percent}% ${direction}).`,
  };
}

function meaningfulWords(name: string): Set<string> {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return new Set(words.filter((word) => word.length > 1 && !FILLER_WORDS.has(word)));
}

function sharesMeaningfulWord(firstName: string, secondName: string): boolean {
  const secondWords = meaningfulWords(secondName);
  return [...meaningfulWords(firstName)].some((word) => secondWords.has(word));
}

function checkCompany(companyName: string, broker: BrokerFacts): ClaimResult {
  if (broker.securityName === null) {
    return {
      claim: 'company',
      status: 'cannot_check',
      aiSaid: companyName,
      brokerSays: null,
      message: `The AI said ${broker.symbol} is "${companyName}", but your broker gave no company name to compare it with.`,
    };
  }
  const brokerName = broker.securityName;
  if (sharesMeaningfulWord(companyName, brokerName)) {
    return {
      claim: 'company',
      status: 'matches',
      aiSaid: companyName,
      brokerSays: brokerName,
      message: `The AI said ${broker.symbol} is "${companyName}", and your broker lists it as "${brokerName}".`,
    };
  }
  return {
    claim: 'company',
    status: 'differs',
    aiSaid: companyName,
    brokerSays: brokerName,
    message: `The AI thinks ${broker.symbol} is "${companyName}", but your broker lists it as "${brokerName}". Make sure this is the company you meant.`,
  };
}

// One result per claim the AI made (price first, then company), or a single "no reasons" result.
export function checkClaims(
  reasoning: AiReasoning | undefined,
  broker: BrokerFacts,
): ClaimResult[] {
  if (reasoning === undefined || !hasAnyReasoning(reasoning)) {
    return [{ claim: 'reasoning', status: 'missing', message: NO_REASONING_MESSAGE }];
  }
  const results: ClaimResult[] = [];
  if (reasoning.expected_price !== undefined) {
    results.push(checkPrice(reasoning.expected_price, broker));
  }
  if (reasoning.company_name !== undefined) {
    results.push(checkCompany(reasoning.company_name, broker));
  }
  return results;
}

export function hasDifferingClaim(results: readonly ClaimResult[]): boolean {
  return results.some((result) => result.status === 'differs');
}
