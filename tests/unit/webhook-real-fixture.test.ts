import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { verifySignature } from '../../src/webhooks/verify.js';

// The ⛔ P12 check (V§21 Q8): a webhook really sent by SnapTrade must verify with our code.
// It runs only when both exist:
//   - tests/fixtures/webhook-real.json = { "body": "<raw request body>", "signature": "<header>" }
//     (captured with WEBHOOK_LOG_BODIES=true on the deployed app, then turned off), and
//   - SNAPTRADE_CONSUMER_KEY in the environment (the real key; never committed).
// Run: SNAPTRADE_CONSUMER_KEY=... npx vitest run tests/unit/webhook-real-fixture.test.ts

const FIXTURE_PATH = new URL('../fixtures/webhook-real.json', import.meta.url);
const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY ?? '';
const canRun = existsSync(FIXTURE_PATH) && consumerKey !== '';

const FixtureSchema = z.object({ body: z.string(), signature: z.string() });

describe.skipIf(!canRun)('a real SnapTrade webhook', () => {
  it('verifies with our canonical JSON and consumer key', () => {
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));

    expect(verifySignature(fixture.body, fixture.signature, consumerKey)).toBe(true);
  });
});
