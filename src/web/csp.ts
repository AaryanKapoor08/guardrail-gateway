import type { Context, MiddlewareHandler } from 'hono';

// The Content-Security-Policy header (V§13): no scripts or third-party content, no framing
// (clickjacking), and forms only post to us.

const POLICY_HEADER = 'Content-Security-Policy';

function buildPolicy(formActionSources: readonly string[]): string {
  return [
    "default-src 'self'",
    "frame-ancestors 'none'",
    `form-action ${formActionSources.join(' ')}`,
    "img-src 'self' data:",
  ].join('; ');
}

// The MCP consent page posts to us, and we then redirect to the AI app. Chrome applies
// `form-action` to that redirect too, so this one page must also allow the app's redirect
// origin, or "Approve" would be blocked on the way back (D15, D20).
export function allowFormRedirectTo(c: Context, redirectOrigin: string): void {
  c.header(POLICY_HEADER, buildPolicy(["'self'", redirectOrigin]));
}

// Runs after the route, so a page that set its own policy (above) keeps it.
export function contentSecurityPolicy(): MiddlewareHandler {
  const defaultPolicy = buildPolicy(["'self'"]);
  return async (c, next) => {
    await next();
    if (!c.res.headers.has(POLICY_HEADER)) {
      c.res.headers.set(POLICY_HEADER, defaultPolicy);
    }
  };
}
