import type { Transaction } from '../db/client.js';
import type { IntentEvent } from '../intents/state-machine.js';
import type { OrderType, Side } from '../policy/types.js';

// The order an executor carries out: an intent the user approved and the re-check passed.
export type ApprovedIntent = {
  readonly id: string;
  readonly userId: string;
  readonly accountRef: string;
  readonly symbol: string;
  readonly currency: string;
  readonly side: Side;
  readonly quantity: string;
  readonly orderType: OrderType;
  readonly limitPrice: string | null;
};

export type ExecutionContext = {
  readonly tx: Transaction;
  readonly now: Date;
  // The fresh market price fetched for the approval-time re-check (V§10.2). Null if the broker
  // had none, in which case nothing can be simulated.
  readonly marketPrice: string | null;
};

export type ExecutionResult = {
  // The state-machine event that moves the intent out of EXECUTING.
  readonly event: Extract<IntentEvent, 'PAPER_FILLED' | 'PAPER_NOT_MARKETABLE'>;
  readonly filledQuantity: string;
  readonly avgFillPrice: string | null;
  readonly note: string;
};

// V§6.5. Paper runs inside the approval transaction (pure database writes). The live executor
// (P13) will run after EXECUTING is committed, outside any transaction.
export type Executor = {
  readonly execute: (intent: ApprovedIntent, context: ExecutionContext) => Promise<ExecutionResult>;
};
