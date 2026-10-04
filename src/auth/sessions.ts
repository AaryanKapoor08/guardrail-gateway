import { and, eq, gt } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../config/env.js';
import type { DatabaseExecutor } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import type { Deps } from '../deps.js';
import { randomToken, sha256Hex } from '../lib/crypto.js';

// Sessions are random 256-bit ids. Only their SHA-256 hash is stored, so a database leak doesn't
// hand out working sessions, and nothing needs a signing secret (V§0 C8, V§13).

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type Session = {
  readonly idHash: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
};

export type SessionUser = {
  readonly id: string;
  readonly snaptradeSub: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly isDemo: boolean;
  readonly killSwitch: boolean;
  readonly mode: 'paper' | 'live';
  readonly needsReauth: boolean;
};

export type SignedIn = { readonly session: Session; readonly user: SessionUser };

// Routes behind `requireSession` can read `c.var.session` and `c.var.user`.
export type SignedInEnv = { Variables: SignedIn };

// The `__Host-` prefix makes browsers refuse the cookie unless it is Secure, has Path=/, and has
// no Domain, so a subdomain can't plant or overwrite it. It needs HTTPS, so production only.
export function sessionCookieName(env: Env): string {
  return env.NODE_ENV === 'production' ? '__Host-gg_session' : 'gg_session';
}

export async function createSession(
  tx: DatabaseExecutor,
  userId: string,
  now: Date,
): Promise<{ sessionId: string; expiresAt: Date }> {
  const sessionId = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await tx.insert(sessions).values({
    idHash: sha256Hex(sessionId),
    userId,
    csrfToken: randomToken(32),
    createdAt: now,
    expiresAt,
  });
  return { sessionId, expiresAt };
}

export function setSessionCookie(c: Context, env: Env, sessionId: string): void {
  setCookie(c, sessionCookieName(env), sessionId, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function loadSession(deps: Deps, c: Context): Promise<SignedIn | null> {
  const sessionId = getCookie(c, sessionCookieName(deps.env));
  if (sessionId === undefined || sessionId === '') {
    return null;
  }
  const [row] = await deps.db
    .select({
      idHash: sessions.idHash,
      csrfToken: sessions.csrfToken,
      expiresAt: sessions.expiresAt,
      user: {
        id: users.id,
        snaptradeSub: users.snaptradeSub,
        email: users.email,
        emailVerified: users.emailVerified,
        isDemo: users.isDemo,
        killSwitch: users.killSwitch,
        mode: users.mode,
        needsReauth: users.needsReauth,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, sha256Hex(sessionId)), gt(sessions.expiresAt, deps.now())));
  if (row === undefined) {
    return null;
  }
  const { user, ...session } = row;
  return { session, user };
}

// Not signed in: a page view goes to sign-in and comes back afterwards. Any other request
// (a form POST) goes to sign-in without a return path, since a POST can't be replayed by GET.
export function requireSession(deps: Deps): MiddlewareHandler<SignedInEnv> {
  return async (c, next) => {
    const signedIn = await loadSession(deps, c);
    if (signedIn === null) {
      if (c.req.method !== 'GET') {
        return c.redirect('/login');
      }
      const url = new URL(c.req.url);
      const returnTo = `${url.pathname}${url.search}`;
      return c.redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
    }
    c.set('session', signedIn.session);
    c.set('user', signedIn.user);
    await next();
  };
}

// Deletes the session row behind the browser's cookie (if any) and clears the cookie.
export async function destroySession(deps: Deps, c: Context): Promise<void> {
  const cookieName = sessionCookieName(deps.env);
  const sessionId = getCookie(c, cookieName);
  if (sessionId !== undefined && sessionId !== '') {
    await deps.db.delete(sessions).where(eq(sessions.idHash, sha256Hex(sessionId)));
  }
  deleteCookie(c, cookieName, {
    path: '/',
    secure: deps.env.NODE_ENV === 'production',
  });
}
