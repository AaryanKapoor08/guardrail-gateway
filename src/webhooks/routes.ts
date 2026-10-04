import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { webhookEvents } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { readLimitedText } from '../lib/read-limited.js';
import { processPending } from './processor.js';
import { verifySignature } from './verify.js';

// POST /webhooks/snaptrade (V§12.4 steps 1–6): cap the body, verify the signature before
// trusting anything, store the event once, answer 200 at once, and process it afterwards.
// No per-IP rate limit here: SnapTrade sends from shared IPs in bursts; the signature check and
// the 64 KB cap protect this route.

const MAX_BODY_BYTES = 64 * 1024;
const STALE_AFTER_MS = 5 * 60 * 1000;

// Field names from SnapTrade's oauth_v1 webhook schema (V§5.5). Verify against the real
// fixture in P12 (webhookId is assumed to be a UUID, as our column is).
const WebhookSchema = z.object({
  schemaVersion: z.literal('oauth_v1'),
  webhookId: z.uuid(),
  oauthClientId: z.string().min(1),
  eventTimestamp: z.iso.datetime({ offset: true }),
  userId: z.string().min(1),
  eventType: z.string().min(1).max(100),
  connectionId: z.string().nullish(),
  accountId: z.string().nullish(),
});

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    // Handled: the caller answers 400.
    return false;
  }
}

function reject(deps: Deps, c: Context, status: 400 | 401 | 413, reason: string): Response {
  deps.logger.warn('Webhook rejected', { event: 'webhook.rejected', status, reason });
  return c.json({ error: reason }, status);
}

// Temporary capture for the real-webhook fixture (P12): logs the raw body and signature when
// WEBHOOK_LOG_BODIES=true. The body holds SnapTrade ids, not secrets. Turn it off afterwards.
function logBodyForFixture(deps: Deps, rawBody: string, signature: string | undefined): void {
  if (deps.env.WEBHOOK_LOG_BODIES) {
    deps.logger.warn(`Webhook body (fixture capture): ${rawBody} | Signature: ${signature ?? ''}`, {
      event: 'webhook.capture',
    });
  }
}

async function storeEvent(deps: Deps, payload: z.infer<typeof WebhookSchema>): Promise<boolean> {
  const now = deps.now();
  const eventTime = new Date(payload.eventTimestamp);
  // Stale events are kept and flagged, not refused: SnapTrade retries arrive 30+ minutes late
  // (V§12.4, API_FEEDBACK F3).
  const stale = now.getTime() - eventTime.getTime() > STALE_AFTER_MS;
  const inserted = await deps.db
    .insert(webhookEvents)
    .values({
      webhookId: payload.webhookId,
      eventType: payload.eventType,
      userSub: payload.userId,
      connectionId: payload.connectionId ?? null,
      accountId: payload.accountId ?? null,
      eventTimestamp: eventTime,
      receivedAt: now,
      stale,
    })
    .onConflictDoNothing({ target: webhookEvents.webhookId })
    .returning({ webhookId: webhookEvents.webhookId });
  return inserted.length === 1;
}

async function receiveWebhook(deps: Deps, c: Context): Promise<Response> {
  if (Number(c.req.header('content-length') ?? '0') > MAX_BODY_BYTES) {
    return reject(deps, c, 413, 'payload_too_large');
  }
  const rawBody = await readLimitedText(c.req.raw.body, MAX_BODY_BYTES);
  if (rawBody === null) {
    return reject(deps, c, 413, 'payload_too_large');
  }
  const signature = c.req.header('signature');
  logBodyForFixture(deps, rawBody, signature);
  if (!isJson(rawBody)) {
    return reject(deps, c, 400, 'invalid_json');
  }
  if (!verifySignature(rawBody, signature, deps.env.SNAPTRADE_CONSUMER_KEY)) {
    return reject(deps, c, 401, 'invalid_signature');
  }
  const payload = WebhookSchema.safeParse(JSON.parse(rawBody));
  if (!payload.success) {
    return reject(deps, c, 400, 'invalid_payload');
  }
  // Another app on the same SnapTrade customer account: not ours to act on.
  if (payload.data.oauthClientId !== deps.env.SNAPTRADE_OAUTH_CLIENT_ID) {
    return c.json({ status: 'ignored' });
  }
  const isNew = await storeEvent(deps, payload.data);
  if (!isNew) {
    return c.json({ status: 'duplicate' });
  }
  deps.logger.info('Webhook stored', { event: 'webhook.received', state: payload.data.eventType });
  deps.background.run('webhook processing', async () => {
    await processPending(deps);
  });
  return c.json({ status: 'received' });
}

export function registerWebhookRoutes(app: Hono, deps: Deps): void {
  app.post('/webhooks/snaptrade', (c) => receiveWebhook(deps, c));
}
