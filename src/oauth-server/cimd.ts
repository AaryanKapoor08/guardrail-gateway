import { z } from 'zod';
import type { Env } from '../config/env.js';
import type { Deps } from '../deps.js';
import { readLimitedText } from '../lib/read-limited.js';

// Client ID Metadata Documents (CIMD, V§11.3 steps 1–3). An MCP client's `client_id` is an
// HTTPS URL; the JSON document at that URL describes the client and its redirect URIs. We only
// fetch documents from allowlisted hosts (MCP_ALLOWED_CLIENT_HOSTS), which keeps look-alike
// clients out and means we never fetch an arbitrary URL (no server-side request forgery).

export const CLIENT_METADATA_MIN_TTL_MS = 5 * 60 * 1000;
export const CLIENT_METADATA_MAX_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 64 * 1024;

const ClientMetadataSchema = z.object({
  client_id: z.string(),
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string()).min(1),
  token_endpoint_auth_method: z.string().optional(),
});

export type ClientMetadata = z.infer<typeof ClientMetadataSchema>;

export type ClientIdCheck =
  | { readonly ok: true; readonly clientHost: string }
  | { readonly ok: false; readonly reason: string };

export type ClientMetadataResult =
  | { readonly ok: true; readonly metadata: ClientMetadata }
  | { readonly ok: false; readonly reason: string };

// Step 1: an https URL with a path, on an allowlisted host, with nothing unusual in it.
export function checkClientIdUrl(env: Env, clientId: string): ClientIdCheck {
  const url = URL.parse(clientId);
  if (url === null || url.protocol !== 'https:') {
    return { ok: false, reason: 'The app identified itself with an invalid address.' };
  }
  if (url.pathname === '/' || url.username !== '' || url.password !== '' || url.hash !== '') {
    return { ok: false, reason: 'The app identified itself with an invalid address.' };
  }
  if (!env.MCP_ALLOWED_CLIENT_HOSTS.includes(url.host)) {
    return { ok: false, reason: `Apps from ${url.host} can't connect to Guardrail Gateway.` };
  }
  return { ok: true, clientHost: url.host };
}

// Honours the document's `Cache-Control: max-age`, kept between 5 minutes and 24 hours.
function cacheLifetimeMs(cacheControl: string | null): number {
  const match = /max-age=(\d+)/i.exec(cacheControl ?? '');
  const requestedMs = match?.[1] === undefined ? 0 : Number(match[1]) * 1000;
  return Math.min(Math.max(requestedMs, CLIENT_METADATA_MIN_TTL_MS), CLIENT_METADATA_MAX_TTL_MS);
}

async function downloadDocument(
  deps: Deps,
  clientIdUrl: string,
): Promise<{ text: string | null; lifetimeMs: number } | null> {
  try {
    const response = await deps.fetch(clientIdUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      deps.logger.warn('Client metadata fetch refused', {
        event: 'oauth.client_fetch_failed',
        status: response.status,
      });
      return null;
    }
    const lifetimeMs = cacheLifetimeMs(response.headers.get('cache-control'));
    return { text: await readLimitedText(response.body, MAX_DOCUMENT_BYTES), lifetimeMs };
  } catch (error) {
    // Handled: the app's host is down or slow; the user sees "try again" and nothing is stored.
    deps.logger.logError('[OAuth] client metadata fetch failed', error);
    return null;
  }
}

function parseDocument(text: string): ClientMetadata | null {
  try {
    const parsed = ClientMetadataSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    // Handled: not JSON at all. Reported to the user as an invalid document.
    return null;
  }
}

// Step 2: download and check the document. Cached, so repeat sign-ins don't refetch it.
export async function fetchClientMetadata(
  deps: Deps,
  clientIdUrl: string,
): Promise<ClientMetadataResult> {
  const cached = deps.caches.clientMetadata.get(clientIdUrl);
  if (cached !== undefined) {
    return { ok: true, metadata: cached };
  }
  const downloaded = await downloadDocument(deps, clientIdUrl);
  if (downloaded === null) {
    return { ok: false, reason: "We couldn't reach the app's registration document. Try again." };
  }
  const metadata = downloaded.text === null ? null : parseDocument(downloaded.text);
  if (metadata === null || metadata.client_id !== clientIdUrl) {
    return { ok: false, reason: "The app's registration document is invalid." };
  }
  if (
    metadata.token_endpoint_auth_method !== undefined &&
    metadata.token_endpoint_auth_method !== 'none'
  ) {
    return {
      ok: false,
      reason: 'The app uses a sign-in method Guardrail Gateway does not support.',
    };
  }
  deps.caches.clientMetadata.set(clientIdUrl, metadata, downloaded.lifetimeMs);
  // Records which client_id URLs real clients use (open question Q5).
  deps.logger.info('MCP client seen', { event: 'oauth.client_seen', clientId: clientIdUrl });
  return { ok: true, metadata };
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Programs on the user's own computer (Claude Code) listen on a random port, so a loopback
// redirect matches a registered one with the same scheme, host, path, and query on any port.
function isSameLoopbackIgnoringPort(requested: string, registered: string): boolean {
  const requestedUrl = URL.parse(requested);
  const registeredUrl = URL.parse(registered);
  if (requestedUrl === null || registeredUrl === null) {
    return false;
  }
  return (
    LOOPBACK_HOSTS.has(requestedUrl.hostname) &&
    requestedUrl.hostname === registeredUrl.hostname &&
    requestedUrl.protocol === registeredUrl.protocol &&
    requestedUrl.pathname === registeredUrl.pathname &&
    requestedUrl.search === registeredUrl.search &&
    requestedUrl.hash === '' &&
    requestedUrl.username === '' &&
    requestedUrl.password === ''
  );
}

// Step 3: the redirect URI must be one the document registered.
export function redirectUriAllowed(requested: string, registered: readonly string[]): boolean {
  return registered.some(
    (candidate) => candidate === requested || isSameLoopbackIgnoringPort(requested, candidate),
  );
}

export function isLoopbackRedirect(redirectUri: string): boolean {
  const url = URL.parse(redirectUri);
  return url !== null && LOOPBACK_HOSTS.has(url.hostname);
}
