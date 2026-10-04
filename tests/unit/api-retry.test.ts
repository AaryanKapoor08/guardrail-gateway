import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/lib/logger.js';
import {
  routeTemplate,
  SnapTradeApiError,
  type SnapTradeRequest,
  sendSnapTradeRequest,
} from '../../src/snaptrade/api.js';
import { buildTestEnv } from '../helpers/env.js';

type Scripted = Response | Error;

// A fetch that answers with the scripted responses in order and counts its calls.
function scriptedFetch(script: Scripted[]) {
  const calls: Request[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(new Request(input, init));
    const next = script.shift();
    if (next === undefined) {
      throw new Error('scripted fetch ran out of responses');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetchFn, calls };
}

function buildApiDeps(fetchFn: typeof fetch) {
  return { env: buildTestEnv(), fetch: fetchFn, logger: createLogger('error', () => {}) };
}

function ok(body: unknown = []): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function status(code: number, init: { headers?: Record<string, string>; body?: string } = {}) {
  return new Response(init.body ?? '{}', { status: code, headers: init.headers ?? {} });
}

const READ: SnapTradeRequest = { method: 'GET', path: '/accounts', retry: 'read' };

describe('sendSnapTradeRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the per-account reset time after a 429, then succeeds', async () => {
    const { fetchFn, calls } = scriptedFetch([
      status(429, { headers: { 'X-RateLimit-Account-Reset': '1' } }),
      ok(),
    ]);
    let settled = false;
    const pending = sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', READ).then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(990);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20);

    expect((await pending).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('falls back to the customer-level reset header, then the body hint', async () => {
    const { fetchFn, calls } = scriptedFetch([
      status(429, { headers: { 'X-RateLimit-Reset': '2' } }),
      status(429, { body: '{"detail":"Request was throttled. Expected available in 3 seconds."}' }),
      ok(),
    ]);
    const pending = sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', READ);

    await vi.advanceTimersByTimeAsync(1990);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2970);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20);

    expect((await pending).status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it('gives up after two retries on repeated 500s', async () => {
    const { fetchFn, calls } = scriptedFetch([status(500), status(500), status(500)]);
    const pending = sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', READ);
    const outcome = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10_000);

    const error = await outcome;
    expect(error).toBeInstanceOf(SnapTradeApiError);
    expect((error as SnapTradeApiError).status).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it('retries a network error on a read', async () => {
    const { fetchFn, calls } = scriptedFetch([new TypeError('socket hang up'), ok()]);
    const pending = sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', READ);

    await vi.advanceTimersByTimeAsync(10_000);

    expect((await pending).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('never retries a request marked retry: none', async () => {
    const { fetchFn, calls } = scriptedFetch([status(503), ok()]);
    const request: SnapTradeRequest = { method: 'POST', path: '/trade/place', retry: 'none' };

    await expect(sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', request)).rejects.toThrow(
      SnapTradeApiError,
    );
    expect(calls).toHaveLength(1);
  });

  it('does not retry a client error like 400', async () => {
    const { fetchFn, calls } = scriptedFetch([status(400), ok()]);

    await expect(sendSnapTradeRequest(buildApiDeps(fetchFn), 'token', READ)).rejects.toThrow(
      'failed with status 400',
    );
    expect(calls).toHaveLength(1);
  });

  it('sends the bearer token to the base URL without the /api/v1 prefix', async () => {
    const { fetchFn, calls } = scriptedFetch([ok()]);

    await sendSnapTradeRequest(buildApiDeps(fetchFn), 'the-token', {
      ...READ,
      query: { symbols: 'abc' },
    });

    expect(calls[0]?.url).toBe('https://api.snaptrade.com/accounts?symbols=abc');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer the-token');
  });
});

describe('routeTemplate', () => {
  it('replaces SnapTrade ids so logs show the endpoint only', () => {
    expect(routeTemplate('/accounts/917c8734-8470-4a3e-a18f-57c3f2ee6631/positions/all')).toBe(
      '/accounts/{id}/positions/all',
    );
    expect(routeTemplate('/authorizations')).toBe('/authorizations');
  });
});
