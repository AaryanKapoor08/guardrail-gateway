import { eq } from 'drizzle-orm';
import { users } from '../db/schema.js';
import { handleDemoRequest } from '../demo/demo-brokerage.js';
import type { Deps } from '../deps.js';
import { sha256Hex } from '../lib/crypto.js';
import { NeedsReauthError } from '../lib/errors.js';
import { getAccessToken, markNeedsReauth, refreshAccessToken } from './tokens.js';

// The one way we call SnapTrade's data API (PRODUCT_VISION §12.1): bearer token, timeout,
// capped retries for reads, and logs that never contain bodies or tokens.

export type SnapTradeRequest = {
  readonly method: 'GET' | 'POST';
  // Without the legacy `/api/v1` prefix, e.g. `/accounts` (V§5.2).
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  // Reads are retried on 429, 5xx, and network errors. Writes ('none') never are: a timeout may
  // still have done the work, and repeating an order placement could place it twice.
  readonly retry: 'read' | 'none';
  readonly timeoutMs?: number;
};

export class SnapTradeApiError extends Error {
  override readonly name = 'SnapTradeApiError';
  // null when no response arrived (timeout or network error).
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

type ApiDeps = Pick<Deps, 'env' | 'fetch' | 'logger'>;

type AttemptResult =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'network-error'; readonly error: unknown };

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_READ_RETRIES = 2;
const MAX_WAIT_MS = 10_000;
const BASE_BACKOFF_MS = 500;
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const AVAILABLE_IN_SECONDS = /available in (\d+) seconds/i;

// `/accounts/<uuid>/balances` -> `/accounts/{id}/balances`, so logs show the endpoint, not ids.
export function routeTemplate(path: string): string {
  return path.replace(UUID_SEGMENT, '/{id}');
}

function buildUrl(deps: ApiDeps, request: SnapTradeRequest): string {
  const url = new URL(`${deps.env.SNAPTRADE_API_BASE_URL}${request.path}`);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

async function sendOnce(
  deps: ApiDeps,
  accessToken: string,
  request: SnapTradeRequest,
): Promise<AttemptResult> {
  const startedMs = performance.now();
  const logFields = { method: request.method, route: routeTemplate(request.path) };
  try {
    const response = await deps.fetch(buildUrl(deps, request), {
      method: request.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: request.body === undefined ? null : JSON.stringify(request.body),
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    deps.logger.info('SnapTrade API call', {
      ...logFields,
      status: response.status,
      durationMs: Math.round(performance.now() - startedMs),
      snaptradeRequestId: response.headers.get('x-request-id'),
    });
    return { kind: 'response', response };
  } catch (error) {
    deps.logger.logError('[SnapTrade] API call got no response', error, logFields);
    return { kind: 'network-error', error };
  }
}

function isRetryable(result: AttemptResult): boolean {
  if (result.kind === 'network-error') {
    return true;
  }
  const { status } = result.response;
  // 501 means the broker doesn't support this call at all (Sandbox symbol search): retrying
  // can't help.
  return status === 429 || (status >= 500 && status !== 501);
}

function secondsFrom(value: string | null): number | null {
  if (value === null || !/^\d+(\.\d+)?$/.test(value.trim())) {
    return null;
  }
  return Number(value);
}

// SnapTrade's 429 hints, in order: the per-account reset header, the customer-level reset
// header, then "Expected available in N seconds" in the body (V§5.4). No hint: exponential
// backoff with full jitter. Every wait is capped at 10 seconds.
async function retryDelayMs(result: AttemptResult, retryNumber: number): Promise<number> {
  if (result.kind === 'response' && result.response.status === 429) {
    const headers = result.response.headers;
    const bodyMatch = AVAILABLE_IN_SECONDS.exec(await result.response.text());
    const hintedSeconds =
      secondsFrom(headers.get('x-ratelimit-account-reset')) ??
      secondsFrom(headers.get('x-ratelimit-reset')) ??
      secondsFrom(bodyMatch?.[1] ?? null);
    if (hintedSeconds !== null) {
      return Math.min(hintedSeconds * 1000, MAX_WAIT_MS);
    }
  }
  return Math.random() * Math.min(MAX_WAIT_MS, BASE_BACKOFF_MS * 2 ** retryNumber);
}

function toApiError(request: SnapTradeRequest, result: AttemptResult): SnapTradeApiError {
  const route = `${request.method} ${routeTemplate(request.path)}`;
  if (result.kind === 'network-error') {
    return new SnapTradeApiError(`[SnapTrade] ${route} got no response`, null, {
      cause: result.error,
    });
  }
  const status = result.response.status;
  return new SnapTradeApiError(`[SnapTrade] ${route} failed with status ${status}`, status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sends the request, retrying reads at most twice. Returns the successful response or throws
// SnapTradeApiError (status only; the body is never logged or put in the error).
export async function sendSnapTradeRequest(
  deps: ApiDeps,
  accessToken: string,
  request: SnapTradeRequest,
): Promise<Response> {
  const maxRetries = request.retry === 'read' ? MAX_READ_RETRIES : 0;
  for (let retryNumber = 0; ; retryNumber += 1) {
    const result = await sendOnce(deps, accessToken, request);
    if (result.kind === 'response' && result.response.ok) {
      return result.response;
    }
    if (retryNumber >= maxRetries || !isRetryable(result)) {
      throw toApiError(request, result);
    }
    await wait(await retryDelayMs(result, retryNumber));
  }
}

async function readJson(request: SnapTradeRequest, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`[SnapTrade] ${routeTemplate(request.path)} returned invalid JSON`, {
      cause: error,
    });
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof SnapTradeApiError && error.status === 401;
}

async function isDemoUser(deps: Deps, userId: string): Promise<boolean> {
  const [user] = await deps.db
    .select({ isDemo: users.isDemo })
    .from(users)
    .where(eq(users.id, userId));
  return user?.isDemo === true;
}

// Demo users never reach SnapTrade (V§4.7): the built-in demo brokerage answers instead, in the
// same shapes, and the caller parses its answer with the same Zod schema as a real one.
function askDemoBrokerage(userId: string, request: SnapTradeRequest): unknown {
  const response = handleDemoRequest({
    userId,
    method: request.method,
    path: request.path,
    query: request.query ?? {},
    body: request.body,
  });
  if (response.status !== 200) {
    const route = `${request.method} ${routeTemplate(request.path)}`;
    throw new SnapTradeApiError(
      `[SnapTrade] ${route} failed with status ${response.status}`,
      response.status,
    );
  }
  return response.body;
}

// Calls SnapTrade as the given user and returns the parsed JSON body (still `unknown`: the
// caller validates it with a Zod schema). A 401 means SnapTrade rejected the token before doing
// anything, so it is safe to refresh once and retry once, even for writes (V§12.1). A second
// 401 means the grant is unusable: the user must reconnect.
export async function snaptradeFetch(
  deps: Deps,
  userId: string,
  request: SnapTradeRequest,
): Promise<unknown> {
  if (await isDemoUser(deps, userId)) {
    return askDemoBrokerage(userId, request);
  }
  const accessToken = await getAccessToken(deps, userId);
  try {
    return await readJson(request, await sendSnapTradeRequest(deps, accessToken, request));
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }
  }
  const freshToken = await refreshAccessToken(deps, userId, sha256Hex(accessToken));
  try {
    return await readJson(request, await sendSnapTradeRequest(deps, freshToken, request));
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }
    await markNeedsReauth(deps, userId, 'token rejected after refresh');
    throw new NeedsReauthError(undefined, { cause: error });
  }
}
