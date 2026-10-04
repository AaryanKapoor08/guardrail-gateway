import type { RuleResult } from '../types.js';
import { pass } from './result.js';

// Always passes. Listed so the AI and the user both see that approval can't be skipped.
export function approvalRequired(): RuleResult {
  return pass(
    'approval_required',
    'Every order needs your approval on the Guardrail Gateway website.',
  );
}
