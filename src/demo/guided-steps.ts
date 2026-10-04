import type { IntentView } from '../intents/view.js';

// The guided tour on /try (V§4.7). Each step is one button that runs a ready-made proposal
// through the real proposeOrder path, recorded as the user ("guided demo"), never as an AI.

export type GuidedStep = {
  readonly id: 'too-big' | 'not-allowed' | 'allowed';
  readonly title: string;
  readonly explanation: string;
  readonly order: { readonly symbol: string; readonly quantity: string };
};

export const GUIDED_STEPS: readonly GuidedStep[] = [
  {
    id: 'too-big',
    title: 'Ask for something too big',
    explanation:
      'Buy 10 × VFV.TO (about $1,524 CAD). Your policy allows $100 per order and $250 a day.',
    order: { symbol: 'VFV.TO', quantity: '10' },
  },
  {
    // 0.001 BTC (about $90) keeps the value inside the limits, so the only problem shown is the
    // one this step is about: crypto isn't a stock or an ETF.
    id: 'not-allowed',
    title: 'Ask for something not allowed',
    explanation: 'Buy 0.001 × BTC (about $90 CAD). Only stocks and ETFs are allowed.',
    order: { symbol: 'BTC', quantity: '0.001' },
  },
  {
    id: 'allowed',
    title: 'Ask for something allowed',
    explanation:
      'Buy 0.5 × VFV.TO (about $76.20 CAD). It passes every rule and waits for your approval.',
    order: { symbol: 'VFV.TO', quantity: '0.5' },
  },
];

export const GUIDED_DEMO_PROPOSER = 'guided demo';

export function findGuidedStep(id: string): GuidedStep | undefined {
  return GUIDED_STEPS.find((step) => step.id === id);
}

function matchesStep(intent: IntentView, step: GuidedStep): boolean {
  return (
    intent.proposedBy === GUIDED_DEMO_PROPOSER &&
    intent.symbol === step.order.symbol &&
    intent.quantity === step.order.quantity
  );
}

// Which steps of the checklist are done, worked out from the user's own intents.
export function completedSteps(intents: readonly IntentView[]): {
  readonly proposed: ReadonlySet<GuidedStep['id']>;
  readonly approved: boolean;
} {
  const proposed = new Set(
    GUIDED_STEPS.filter((step) => intents.some((intent) => matchesStep(intent, step))).map(
      (step) => step.id,
    ),
  );
  const approved = intents.some(
    (intent) => intent.proposedBy === GUIDED_DEMO_PROPOSER && intent.status === 'FILLED',
  );
  return { proposed, approved };
}
