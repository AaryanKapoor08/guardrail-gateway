import { z } from 'zod';
import type { Deps } from '../deps.js';

// SnapTrade's endpoints are read from its published metadata, never hard-coded, so a change on
// their side doesn't silently break sign-in. Both documents are needed: the revocation endpoint
// is only in the OAuth document and the JWKS URL only in the OpenID one (PRODUCT_VISION §5.1).

export const METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 10_000;

const AuthorizationServerMetadataSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  revocation_endpoint: z.url(),
});

const OpenIdConfigurationSchema = z.object({
  issuer: z.string(),
  jwks_uri: z.url(),
});

export type SnapTradeMetadata = {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly jwksUri: string;
};

async function fetchDocument(deps: Deps, url: string): Promise<unknown> {
  const response = await deps.fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`[Discovery] SnapTrade metadata request failed with status ${response.status}`);
  }
  return response.json();
}

async function fetchSnapTradeMetadata(deps: Deps): Promise<SnapTradeMetadata> {
  const issuer = deps.env.SNAPTRADE_ISSUER;
  const [oauthDocument, openIdDocument] = await Promise.all([
    fetchDocument(deps, `${issuer}/.well-known/oauth-authorization-server`),
    fetchDocument(deps, `${issuer}/.well-known/openid-configuration`),
  ]);
  const oauthResult = AuthorizationServerMetadataSchema.safeParse(oauthDocument);
  const openIdResult = OpenIdConfigurationSchema.safeParse(openIdDocument);
  if (!oauthResult.success || !openIdResult.success) {
    throw new Error('[Discovery] SnapTrade metadata is missing fields we need');
  }
  const oauth = oauthResult.data;
  const openId = openIdResult.data;
  // A document claiming a different issuer could point us at someone else's endpoints.
  if (oauth.issuer !== issuer || openId.issuer !== issuer) {
    throw new Error('[Discovery] SnapTrade metadata issuer does not match SNAPTRADE_ISSUER');
  }
  return {
    issuer,
    authorizationEndpoint: oauth.authorization_endpoint,
    tokenEndpoint: oauth.token_endpoint,
    revocationEndpoint: oauth.revocation_endpoint,
    jwksUri: openId.jwks_uri,
  };
}

export function getSnapTradeMetadata(deps: Deps): Promise<SnapTradeMetadata> {
  return deps.caches.snaptradeMetadata.getOrLoad('metadata', () => fetchSnapTradeMetadata(deps));
}
