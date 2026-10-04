import type { RuleInput, RuleResult } from '../types.js';
import { fail, pass } from './result.js';

export function killSwitchOff({ context }: RuleInput): RuleResult {
  if (context.killSwitch) {
    return fail(
      'kill_switch_off',
      'The kill switch is on, so no orders are accepted. Turn it off on the dashboard.',
    );
  }
  return pass('kill_switch_off', 'The kill switch is off.');
}
