import type { Context, Hono } from 'hono';
import type { Env } from '../config/env.js';

// Discovery documents for MCP clients (V§11.3 Metadata). Claude reads the Protected Resource
// Metadata after its first 401 from /mcp, then our Authorization Server Metadata, and uses CIMD
// because we advertise both `client_id_metadata_document_supported` and the "none" auth method.

export const SCOPE_MCP = 'mcp';
export const SCOPE_OFFLINE_ACCESS = 'offline_access';
export const SUPPORTED_SCOPES = [SCOPE_MCP, SCOPE_OFFLINE_ACCESS] as const;

// The MCP endpoint is the "resource" our tokens are bound to (RFC 8707 audience).
export function mcpResourceUrl(env: Env): string {
  return `${env.APP_BASE_URL}/mcp`;
}

export function protectedResourceMetadataUrl(env: Env): string {
  return `${env.APP_BASE_URL}/.well-known/oauth-protected-resource/mcp`;
}

export function protectedResourceMetadata(env: Env) {
  return {
    resource: mcpResourceUrl(env),
    authorization_servers: [env.APP_BASE_URL],
    scopes_supported: [SCOPE_MCP],
    bearer_methods_supported: ['header'],
  };
}

export function authorizationServerMetadata(env: Env) {
  const base = env.APP_BASE_URL;
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

// Public documents: any site may read them (a browser-based MCP client fetches them directly),
// and clients may cache them for 5 minutes.
function publicJson(c: Context, body: object): Response {
  c.header('Cache-Control', 'max-age=300');
  c.header('Access-Control-Allow-Origin', '*');
  return c.json(body);
}

export function registerMetadataRoutes(app: Hono, env: Env): void {
  const resourceMetadata = protectedResourceMetadata(env);
  const serverMetadata = authorizationServerMetadata(env);
  app.get('/.well-known/oauth-protected-resource', (c) => publicJson(c, resourceMetadata));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => publicJson(c, resourceMetadata));
  app.get('/.well-known/oauth-authorization-server', (c) => publicJson(c, serverMetadata));
}
