import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

// SnapTrade security type codes in plain words.
const TYPE_LABELS: Readonly<Record<string, string>> = {
  cs: 'Stock',
  et: 'ETF',
  crypto: 'Crypto',
  oef: 'Mutual fund',
  cef: 'Closed-end fund',
  ad: 'ADR',
  bnd: 'Bond',
  wt: 'Warrant',
  rt: 'Right',
  ps: 'Preferred share',
};

export function securityTypeLabel(typeCode: string): string {
  return TYPE_LABELS[typeCode] ?? `Security type "${typeCode}"`;
}

export function assetTypeAllowed({ policy, context }: RuleInput): RuleResult {
  const { security } = context;
  if (security === null) {
    return fail('asset_type_allowed', 'The security type is unknown.');
  }
  const label = securityTypeLabel(security.typeCode);
  const isAllowed = policy.assetTypes.some((type) => type === security.typeCode);
  if (!isAllowed) {
    return fail('asset_type_allowed', `${label} isn't allowed; only stocks and ETFs.`);
  }
  return pass('asset_type_allowed', `${label} is an allowed security type.`);
}
