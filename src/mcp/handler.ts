import { readFileSync } from 'node:fs';
import {
  type AuthInfo,
  createMcpHandler,
  hostHeaderValidationResponse,
  McpServer,
  originValidationResponse,
  requireBearerAuth,
} from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import {
  mcpResourceUrl,
  protectedResourceMetadataUrl,
  SCOPE_MCP,
} from '../oauth-server/metadata.js';
import { verifyAccessToken } from '../oauth-server/verify.js';
import { type McpCaller, McpCallerSchema, type ToolContext } from './tool-kit.js';
import { registerCancelOrderIntentTool } from './tools/cancel-order-intent.js';
import { registerGetBalancesTool } from './tools/get-balances.js';
import { registerGetOrderStatusTool } from './tools/get-order-status.js';
import { registerGetPolicyTool } from './tools/get-policy.js';
import { registerGetPositionsTool } from './tools/get-positions.js';
import { registerListAccountsTool } from './tools/list-accounts.js';
import { registerListRecentIntentsTool } from './tools/list-recent-intents.js';
import { registerProposeOrderTool } from './tools/propose-order.js';

// POST /mcp (V§11.1): our bearer token, then a fresh, stateless MCP server per request that
// knows only the caller from that token. JSON responses only (no streaming needed).

const SERVER_NAME = 'guardrail-gateway';

// package.json sits two levels up from both src/mcp and dist/mcp.
function readServerVersion(): string {
  const packageJson = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  return z.object({ version: z.string() }).parse(JSON.parse(packageJson)).version;
}

// The token's extra data comes from our own verifier, so a mismatch here is a bug.
function callerFrom(authInfo: AuthInfo | undefined): McpCaller {
  const parsed = McpCallerSchema.safeParse(authInfo?.extra);
  if (!parsed.success) {
    throw new Error('[MCP] request reached the server without a verified caller');
  }
  return parsed.data;
}

// The 8 tools, always in this order (V§11.2). There is deliberately no tool to approve, deny,
// change the policy, allow accounts, use the kill switch, switch mode, or disconnect.
export function buildMcpServer(deps: Deps, caller: McpCaller, version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  const context: ToolContext = { deps, caller };
  registerListAccountsTool(server, context);
  registerGetPositionsTool(server, context);
  registerGetBalancesTool(server, context);
  registerGetPolicyTool(server, context);
  registerProposeOrderTool(server, context);
  registerGetOrderStatusTool(server, context);
  registerListRecentIntentsTool(server, context);
  registerCancelOrderIntentTool(server, context);
  return server;
}

export function registerMcpRoutes(app: Hono, deps: Deps): void {
  const version = readServerVersion();
  const gate = requireBearerAuth({
    verifier: { verifyAccessToken: verifyAccessToken(deps) },
    requiredScopes: [SCOPE_MCP],
    resourceMetadataUrl: protectedResourceMetadataUrl(deps.env),
    expectedResource: new URL(mcpResourceUrl(deps.env)),
  });
  const handler = createMcpHandler(
    ({ authInfo }) => buildMcpServer(deps, callerFrom(authInfo), version),
    {
      responseMode: 'json',
      onerror: (error) => deps.logger.logError('[MCP] request failed', error),
    },
  );
  // DNS-rebinding protection: only our public host name, and no other site's pages.
  const ourHostname = [new URL(deps.env.APP_BASE_URL).hostname];

  app.all('/mcp', async (c) => {
    const request = c.req.raw;
    const rejected =
      hostHeaderValidationResponse(request, ourHostname) ??
      originValidationResponse(request, ourHostname);
    if (rejected !== undefined) {
      return rejected;
    }
    const authInfo = await gate(request);
    if (authInfo instanceof Response) {
      return authInfo;
    }
    return handler.fetch(request, { authInfo });
  });
}
