import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type SessionResponse, sessionResponseSchema } from '@core-studio/contracts';
import request from 'supertest';
import { APP_ORIGIN, TENANT_ID } from './app.js';

export interface TestIdentity {
  oid: string;
  tid?: string;
  name: string;
  email?: string;
}

export const newIdentity = (name = 'Test User'): TestIdentity => ({
  oid: randomUUID(),
  name,
  email: `${randomUUID()}@corp.test`,
});

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  const line = setCookie?.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0]?.slice(name.length + 1);
}

export const setCookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
};

/** Drives the real authorization-code flow against the test OIDC server's sign-in form. */
export async function authorizeAtIdp(authorizeUrl: string, identity: TestIdentity): Promise<URL> {
  const claims = JSON.stringify({
    oid: identity.oid,
    tid: identity.tid ?? TENANT_ID,
    name: identity.name,
    ...(identity.email ? { email: identity.email } : {}),
  });
  const response = await fetch(authorizeUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: identity.oid, claims }),
  });
  const location = response.headers.get('location');
  if (response.status !== 302 || !location)
    throw new Error(`IdP did not redirect (status ${String(response.status)})`);
  return new URL(location);
}

export interface SignedIn {
  cookie: string;
  sessionId: string;
  csrf: string;
  session: SessionResponse;
}

/** Full sign-in: /auth/login → IdP form → /auth/callback; returns the session cookie and CSRF token. */
export async function signIn(
  app: NestExpressApplication,
  identity: TestIdentity,
  options: { existingCookie?: string; path?: string } = {},
): Promise<SignedIn> {
  const server = app.getHttpServer();
  const login = await request(server)
    .get(options.path ?? '/api/v1/auth/login?returnTo=/projects')
    .set('Cookie', options.existingCookie ?? '');
  const binding = cookieValue(setCookies(login), '__Host-core_login');
  if (login.status !== 303 || !binding)
    throw new Error(`Login did not start (status ${String(login.status)})`);
  const callback = await authorizeAtIdp(login.headers['location'] as string, identity);

  const cookies = [`__Host-core_login=${binding}`];
  if (options.existingCookie) cookies.push(options.existingCookie);
  const done = await request(server)
    .get(`${callback.pathname}${callback.search}`)
    .set('Cookie', cookies.join('; '));
  const sessionId = cookieValue(setCookies(done), '__Host-core_sid');
  if (done.status !== 303 || !sessionId) {
    throw new Error(
      `Callback failed: ${String(done.status)} → ${String(done.headers['location'])}`,
    );
  }
  const cookie = `__Host-core_sid=${sessionId}`;
  const sessionRes = await request(server)
    .get('/api/v1/auth/session')
    .set('Cookie', cookie)
    .expect(200);
  const session = sessionResponseSchema.parse(sessionRes.body);
  return { cookie, sessionId, csrf: session.csrfToken, session };
}

/** Unsafe request helper with the CSRF token and same-origin header a real browser sends. */
export function mutate(
  app: NestExpressApplication,
  method: 'post' | 'patch' | 'delete',
  path: string,
  who: SignedIn,
) {
  const agent = request(app.getHttpServer());
  return agent[method](path)
    .set('Cookie', who.cookie)
    .set('Origin', APP_ORIGIN)
    .set('x-csrf-token', who.csrf);
}

export async function refreshSession(
  app: NestExpressApplication,
  who: SignedIn,
): Promise<SignedIn> {
  const res = await request(app.getHttpServer())
    .get('/api/v1/auth/session')
    .set('Cookie', who.cookie)
    .expect(200);
  return { ...who, session: sessionResponseSchema.parse(res.body) };
}
