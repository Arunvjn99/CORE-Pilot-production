import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorResponseSchema, logoutResponseSchema } from '@core-studio/contracts';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../../src/auth/session.store.js';
import { REDIS } from '../../src/redis/redis.tokens.js';
import { APP_ORIGIN, createTestApp } from './support/app.js';
import { authorizeAtIdp, mutate, newIdentity, setCookies, signIn } from './support/oidc.js';

let app: NestExpressApplication;
const server = () => app.getHttpServer();

beforeAll(async () => {
  ({ app } = await createTestApp());
});
afterAll(async () => {
  await app.close();
});

describe('OIDC sign-in (BFF)', () => {
  it('starts login with PKCE S256, state, nonce and a browser-binding cookie', async () => {
    const res = await request(server()).get('/api/v1/auth/login').expect(303);
    const url = new URL(res.headers['location'] as string);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/api/v1/auth/callback`);
    expect(setCookies(res).join(';')).toMatch(
      /__Host-core_login=.+HttpOnly.*Secure|__Host-core_login=.+Secure.*HttpOnly/,
    );
  });

  it('creates a hardened session cookie and exposes no tokens to the browser', async () => {
    const who = await signIn(app, newIdentity('Alice Example'));
    expect(who.session.user.displayName).toBe('Alice Example');
    expect(who.session.organizations).toEqual([]);
    expect(who.session.activeOrganizationId).toBeNull();
    const body = JSON.stringify(who.session);
    expect(body).not.toMatch(/id_token|access_token|refresh_token|eyJ/);
  });

  it('sets __Host- session cookie flags', async () => {
    const login = await request(server()).get('/api/v1/auth/login');
    const binding = setCookies(login)[0]?.split(';')[0] ?? '';
    const callback = await authorizeAtIdp(login.headers['location'] as string, newIdentity());
    const done = await request(server())
      .get(`${callback.pathname}${callback.search}`)
      .set('Cookie', binding)
      .expect(303);
    const sid = setCookies(done).find((c) => c.startsWith('__Host-core_sid='));
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/Secure/);
    expect(sid).toMatch(/SameSite=Lax/);
    expect(sid).toMatch(/Path=\//);
    expect(sid).not.toMatch(/Domain=/);
  });

  it('rejects a callback that did not start in this browser (login CSRF)', async () => {
    const login = await request(server()).get('/api/v1/auth/login');
    const callback = await authorizeAtIdp(login.headers['location'] as string, newIdentity());
    const res = await request(server()).get(`${callback.pathname}${callback.search}`).expect(303);
    expect(res.headers['location']).toBe('/?authError=expired');
    expect(
      setCookies(res).some((c) => c.startsWith('__Host-core_sid=') && !c.includes('Max-Age=0')),
    ).toBe(false);
  });

  it('rejects replayed state', async () => {
    const login = await request(server()).get('/api/v1/auth/login');
    const binding = setCookies(login)[0]?.split(';')[0] ?? '';
    const callback = await authorizeAtIdp(login.headers['location'] as string, newIdentity());
    const path = `${callback.pathname}${callback.search}`;
    await request(server()).get(path).set('Cookie', binding).expect(303);
    const replay = await request(server()).get(path).set('Cookie', binding).expect(303);
    expect(replay.headers['location']).toBe('/?authError=expired');
  });

  it('rejects identities from another tenant', async () => {
    await expect(
      signIn(app, { ...newIdentity(), tid: '99999999-9999-4999-8999-999999999999' }),
    ).rejects.toThrow(/authError=failed/);
  });

  it('only redirects to same-app relative paths after login', async () => {
    for (const evil of ['//evil.test/x', '/\\evil.test', 'https://evil.test']) {
      const login = await request(server()).get(
        `/api/v1/auth/login?returnTo=${encodeURIComponent(evil)}`,
      );
      const binding = setCookies(login)[0]?.split(';')[0] ?? '';
      const callback = await authorizeAtIdp(login.headers['location'] as string, newIdentity());
      const done = await request(server())
        .get(`${callback.pathname}${callback.search}`)
        .set('Cookie', binding);
      expect(done.headers['location']).toBe('/');
    }
  });

  it('issues a new session id on every sign-in (session fixation)', async () => {
    const identity = newIdentity();
    const first = await signIn(app, identity);
    const second = await signIn(app, identity, { existingCookie: first.cookie });
    expect(second.sessionId).not.toBe(first.sessionId);
    await request(server()).get('/api/v1/auth/session').set('Cookie', first.cookie).expect(401);
  });
});

describe('Session lifecycle', () => {
  it('returns 401 with the error envelope without a session', async () => {
    const res = await request(server()).get('/api/v1/auth/session').expect(401);
    expect(errorResponseSchema.parse(res.body).error.code).toBe('UNAUTHORIZED');
    await request(server())
      .get('/api/v1/auth/session')
      .set('Cookie', '__Host-core_sid=not-a-real-session')
      .expect(401);
  });

  it('signs out and invalidates the session', async () => {
    const who = await signIn(app, newIdentity());
    const res = await mutate(app, 'post', '/api/v1/auth/logout', who).expect(200);
    expect(logoutResponseSchema.parse(res.body).endSessionUrl).toMatch(/endsession/);
    expect(
      setCookies(res).some((c) => c.startsWith('__Host-core_sid=;') && c.includes('Max-Age=0')),
    ).toBe(true);
    await request(server()).get('/api/v1/auth/session').set('Cookie', who.cookie).expect(401);
  });

  it('expires sessions past their absolute lifetime', async () => {
    const who = await signIn(app, newIdentity());
    const redis = app.get<Redis>(REDIS);
    const key = `session:${sha256(who.sessionId)}`;
    const stored = JSON.parse((await redis.get(key)) ?? '{}') as { createdAt: number };
    stored.createdAt = Date.now() - 13 * 3_600_000;
    await redis.set(key, JSON.stringify(stored), 'KEEPTTL');
    await request(server()).get('/api/v1/auth/session').set('Cookie', who.cookie).expect(401);
    expect(await redis.exists(key)).toBe(0);
  });

  it('stores only hashed session ids in Redis', async () => {
    const who = await signIn(app, newIdentity());
    const redis = app.get<Redis>(REDIS);
    expect(await redis.exists(`session:${who.sessionId}`)).toBe(0);
    expect(await redis.exists(`session:${sha256(who.sessionId)}`)).toBe(1);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a valid token or from another origin', async () => {
    const who = await signIn(app, newIdentity());
    const noToken = await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', who.cookie)
      .set('Origin', APP_ORIGIN)
      .expect(403);
    expect(errorResponseSchema.parse(noToken.body).error.message).toMatch(/CSRF/);
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', who.cookie)
      .set('Origin', APP_ORIGIN)
      .set('x-csrf-token', 'wrong')
      .expect(403);
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', who.cookie)
      .set('Origin', 'http://evil.test')
      .set('x-csrf-token', who.csrf)
      .expect(403);
    await request(server())
      .post('/api/v1/auth/logout')
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .expect(403);
    // still signed in
    await request(server()).get('/api/v1/auth/session').set('Cookie', who.cookie).expect(200);
  });
});

describe('Step-up re-authentication', () => {
  it('blocks sensitive routes until a forced re-authentication, then allows them', async () => {
    const identity = newIdentity();
    const who = await signIn(app, identity);
    const blocked = await request(server())
      .get('/api/v1/test-sensitive')
      .set('Cookie', who.cookie)
      .expect(403);
    expect(errorResponseSchema.parse(blocked.body).error.code).toBe('REAUTH_REQUIRED');

    const start = await request(server())
      .get('/api/v1/auth/step-up?returnTo=/settings')
      .set('Cookie', who.cookie)
      .expect(303);
    const authorize = new URL(start.headers['location'] as string);
    expect(authorize.searchParams.get('prompt')).toBe('login');
    const binding = setCookies(start)[0]?.split(';')[0] ?? '';
    const callback = await authorizeAtIdp(authorize.href, identity);
    const done = await request(server())
      .get(`${callback.pathname}${callback.search}`)
      .set('Cookie', `${binding}; ${who.cookie}`)
      .expect(303);
    expect(done.headers['location']).toBe('/settings');

    await request(server()).get('/api/v1/test-sensitive').set('Cookie', who.cookie).expect(200);
    const session = await request(server())
      .get('/api/v1/auth/session')
      .set('Cookie', who.cookie)
      .expect(200);
    expect((session.body as { recentAuthUntil: string | null }).recentAuthUntil).not.toBeNull();
  });

  it('refuses a step-up completed by a different user', async () => {
    const who = await signIn(app, newIdentity());
    const start = await request(server()).get('/api/v1/auth/step-up').set('Cookie', who.cookie);
    const binding = setCookies(start)[0]?.split(';')[0] ?? '';
    const callback = await authorizeAtIdp(
      start.headers['location'] as string,
      newIdentity('Someone Else'),
    );
    const done = await request(server())
      .get(`${callback.pathname}${callback.search}`)
      .set('Cookie', `${binding}; ${who.cookie}`)
      .expect(303);
    expect(done.headers['location']).toBe('/?authError=failed');
    await request(server()).get('/api/v1/test-sensitive').set('Cookie', who.cookie).expect(403);
  });
});
