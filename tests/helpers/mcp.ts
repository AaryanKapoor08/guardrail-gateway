import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { z } from 'zod';
import type { TestApp } from './app.js';
import { MCP_RESOURCE } from './oauth.js';

// A real MCP client (the SDK's) talking to our app in-process: its fetch goes straight to
// `app.fetch` with the bearer token, as Claude's requests would arrive.

export const TEST_HOST = 'localhost:3000';

export function mcpFetch(testApp: TestApp, accessToken: string) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set('host', TEST_HOST);
    return testApp.app.fetch(new Request(request, { headers }));
  };
}

function transportFor(testApp: TestApp, accessToken: string): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(MCP_RESOURCE), {
    fetch: mcpFetch(testApp, accessToken),
  });
}

// A 2025-era client (the SDK's default): `initialize` handshake, then requests.
export async function connectMcpClient(testApp: TestApp, accessToken: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transportFor(testApp, accessToken));
  return client;
}

// A client pinned to the stateless 2026-07-28 protocol revision.
export async function connectModernMcpClient(
  testApp: TestApp,
  accessToken: string,
): Promise<Client> {
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(transportFor(testApp, accessToken));
  return client;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

export function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}

// The intent_id from a propose_order result.
export function intentIdOf(result: CallToolResult): string {
  const parsed = z.object({ intent_id: z.string() }).safeParse(result.structuredContent);
  return parsed.success ? parsed.data.intent_id : '';
}
