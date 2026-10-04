import type { Deps } from '../deps.js';
import { approvalUrlFor, type IntentView, shortSummary } from '../intents/view.js';
import { fmtToronto } from '../lib/time.js';

// Optional, best-effort "approval needed" email via Resend's HTTP API (V§9.3). The dashboard
// and the link returned to the AI are the reliable channels; this is a convenience.

const RESEND_URL = 'https://api.resend.com/emails';
const EMAIL_TIMEOUT_MS = 10_000;

export type EmailRecipient = {
  readonly email: string | null;
  readonly emailVerified: boolean;
};

function buildEmail(deps: Deps, intent: IntentView) {
  const url = approvalUrlFor(deps.env.APP_BASE_URL, intent.id);
  return {
    subject: `Approval needed: ${shortSummary(intent)} (${intent.mode})`,
    // No account numbers, no tokens, and no approve button: the link only opens the page.
    text: [
      `An AI assistant proposed: ${shortSummary(intent)} (${intent.orderType}, ${intent.mode} mode).`,
      `It expires at ${fmtToronto(intent.expiresAt)}.`,
      `Review it and decide here: ${url}`,
      '',
      'Not financial advice. Guardrail Gateway never recommends trades.',
    ].join('\n'),
  };
}

function skipReason(deps: Deps, recipient: EmailRecipient): string | null {
  if (deps.env.RESEND_API_KEY === undefined || deps.env.EMAIL_FROM === undefined) {
    return 'email not configured';
  }
  if (recipient.email === null || !recipient.emailVerified) {
    return 'no verified email';
  }
  return null;
}

// Never throws: a failed email must never fail the proposal.
export async function sendApprovalEmail(
  deps: Deps,
  recipient: EmailRecipient,
  intent: IntentView,
): Promise<void> {
  const reason = skipReason(deps, recipient);
  if (reason !== null || recipient.email === null) {
    deps.logger.info('Approval email skipped', {
      event: 'email.skipped',
      reason,
      intentId: intent.id,
    });
    return;
  }
  const { subject, text } = buildEmail(deps, intent);
  try {
    const response = await deps.fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${deps.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: deps.env.EMAIL_FROM, to: recipient.email, subject, text }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    deps.logger.info('Approval email sent', {
      event: response.ok ? 'email.sent' : 'email.rejected',
      status: response.status,
      intentId: intent.id,
    });
  } catch (error) {
    // Handled: email is best effort; the dashboard still lists the pending approval.
    deps.logger.logError('[Email] approval email failed', error, { intentId: intent.id });
  }
}
