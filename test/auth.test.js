import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { onRequest as auth } from '../functions/auth/[[action]].js';
import { onRequest as proxy } from '../functions/ct-proxy/[[path]].js';
import { CHURCHTOOLS_ORIGIN, SESSION_COOKIE, LOGIN_COOKIE, seal, readCookie, session, challenge } from '../server/session.js';

const origin = 'https://editor.example';
const env = { CHURCHTOOLS_CLIENT_ID: 'test-client', SESSION_SECRET: 'test-only-session-secret-with-at-least-32-characters' };
const request = (path, options = {}) => new Request(`${origin}${path}`, options);
const cookiePair = (response, name) => response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(';')[0];
afterEach(() => mock.restoreAll());

async function start() {
  const response = await auth({ env, request: request('/auth/login', { method: 'POST', headers: { Origin: origin } }) });
  assert.equal(response.status, 200);
  return { response, loginCookie: cookiePair(response, LOGIN_COOKIE), url: new URL((await response.json()).url) };
}

async function loggedInCookie() {
  return `${SESSION_COOKIE}=${await seal({ purpose: 'session', accessToken: 'private-access-token', expiresAt: Date.now() + 60_000 }, env)}`;
}

test('login uses the fixed ChurchTools authorization endpoint, api scope, state and S256 PKCE', async () => {
  const { response, loginCookie, url } = await start();
  assert.equal(url.origin, CHURCHTOOLS_ORIGIN);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), env.CHURCHTOOLS_CLIENT_ID);
  assert.equal(url.searchParams.get('scope'), 'api');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/auth/callback`);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state').length >= 32);
  const pending = await readCookie(request('/', { headers: { Cookie: loginCookie } }), LOGIN_COOKIE, env);
  assert.equal(url.searchParams.get('code_challenge'), await challenge(pending.verifier));
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(!url.href.includes(pending.verifier));
});

test('callback exchanges the code server-side and sets a private session usable by the proxy', async () => {
  const { loginCookie, url } = await start();
  const fetchMock = mock.method(globalThis, 'fetch', async (target, options) => {
    assert.equal(target, `${CHURCHTOOLS_ORIGIN}/oauth/access_token`);
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('grant_type'), 'authorization_code');
    assert.equal(options.body.get('code'), 'single-use-code');
    assert.equal(options.body.get('redirect_uri'), `${origin}/auth/callback`);
    assert.equal(options.body.get('client_secret'), 'server-only-secret');
    assert.ok(options.body.get('code_verifier'));
    return Response.json({ access_token: 'private-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'api' });
  });
  const response = await auth({ env: { ...env, CHURCHTOOLS_CLIENT_SECRET: 'server-only-secret' }, request: request(`/auth/callback?code=single-use-code&state=${url.searchParams.get('state')}`, { headers: { Cookie: loginCookie } }) });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('Location'), '/');
  const sessionCookie = cookiePair(response, SESSION_COOKIE);
  assert.ok(sessionCookie);
  assert.ok(!sessionCookie.includes('private-access-token'));
  assert.match(response.headers.getSetCookie().find((c) => c.startsWith(`${LOGIN_COOKIE}=`)), /Max-Age=0/);
  const sessionRequest = request('/auth/session', { headers: { Cookie: sessionCookie } });
  assert.equal((await session(sessionRequest, env)).accessToken, 'private-access-token');
  const status = await auth({ env, request: sessionRequest });
  assert.deepEqual(await status.json(), { authenticated: true, configured: true });
});

test('missing, mismatched, expired and duplicate OAuth state never trigger an exchange', async () => {
  const { loginCookie, url } = await start();
  const state = url.searchParams.get('state');
  const expired = `${LOGIN_COOKIE}=${await seal({ purpose: 'login', state, expiresAt: Date.now() - 1 }, env)}`;
  const calls = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  for (const [query, cookies] of [
    [`code=x&state=${state}`, ''], ['code=x&state=wrong', loginCookie],
    [`code=x&state=${state}`, expired], [`code=x&state=${state}&state=${state}`, loginCookie],
    [`code=x&code=y&state=${state}`, loginCookie],
  ]) {
    const response = await auth({ env, request: request(`/auth/callback?${query}`, { headers: { Cookie: cookies } }) });
    assert.equal(response.headers.get('Location'), '/?auth_error=invalid_state');
    assert.equal(cookiePair(response, SESSION_COOKIE), undefined);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test('denied consent and failed or malformed token exchanges return safe errors', async () => {
  const { loginCookie, url } = await start();
  const state = url.searchParams.get('state');
  const denied = await auth({ env, request: request(`/auth/callback?error=access_denied&state=${state}`, { headers: { Cookie: loginCookie } }) });
  assert.equal(denied.headers.get('Location'), '/?auth_error=denied');
  for (const token of [null, {}, { access_token: 'x', expires_in: -1 }, { access_token: 'x', token_type: 'Basic' }, { access_token: 'x', scope: 'profile' }]) {
    mock.method(globalThis, 'fetch', async () => token === null ? new Response('sensitive upstream error', { status: 400 }) : Response.json(token));
    const response = await auth({ env, request: request(`/auth/callback?code=x&state=${state}`, { headers: { Cookie: loginCookie } }) });
    assert.match(response.headers.get('Location'), /^\/\?auth_error=(exchange_failed|invalid_token)$/);
    assert.equal(cookiePair(response, SESSION_COOKIE), undefined);
    mock.restoreAll();
  }
});

test('encrypted cookies reject tampering, expired credentials and a login cookie used as a session', async () => {
  const valid = await loggedInCookie();
  const altered = valid.slice(0, -8) + 'AAAAAAAA';
  const expired = `${SESSION_COOKIE}=${await seal({ purpose: 'session', accessToken: 'x', expiresAt: Date.now() - 1 }, env)}`;
  const pending = `${SESSION_COOKIE}=${await seal({ purpose: 'login', accessToken: 'x', expiresAt: Date.now() + 60_000 }, env)}`;
  for (const Cookie of [altered, expired, pending, `${SESSION_COOKIE}=invalid`]) {
    assert.equal(await session(request('/', { headers: { Cookie } }), env), null);
  }
});

test('logout removes both cookies; mutating auth routes require same-origin POST', async () => {
  for (const path of ['/auth/login', '/auth/logout']) {
    for (const headers of [{}, { Origin: 'https://evil.example' }]) {
      assert.equal((await auth({ env, request: request(path, { method: 'POST', headers }) })).status, 403);
    }
    assert.equal((await auth({ env, request: request(path) })).status, 405);
  }
  const response = await auth({ env, request: request('/auth/logout', { method: 'POST', headers: { Origin: origin } }) });
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.ok(response.headers.getSetCookie().every((c) => c.includes('Max-Age=0')));
});

test('missing configuration is reported without exposing secrets', async () => {
  assert.deepEqual(await (await auth({ env: {}, request: request('/auth/session') })).json(), { authenticated: false, configured: false });
  const response = await auth({ env: {}, request: request('/auth/login', { method: 'POST', headers: { Origin: origin } }) });
  assert.equal(response.status, 503);
});

test('proxy requires an authenticated cookie, never accepts manually supplied tokens', async () => {
  const response = await proxy({ env, params: { path: ['api', 'songs'] }, request: request('/ct-proxy/api/songs', { headers: { Authorization: 'Login manual-token' } }) });
  assert.equal(response.status, 401);
});

test('proxy forwards the OAuth bearer and strips upstream cookies', async () => {
  const Cookie = await loggedInCookie();
  mock.method(globalThis, 'fetch', async (target, init) => {
    assert.equal(String(target), `${CHURCHTOOLS_ORIGIN}/api/songs?page=2`);
    assert.equal(init.headers.get('Authorization'), 'Bearer private-access-token');
    assert.equal(init.headers.get('Cookie'), null);
    return Response.json({ data: [] }, { headers: { 'Set-Cookie': 'upstream=secret' } });
  });
  const response = await proxy({ env, params: { path: ['api', 'songs'] }, request: request('/ct-proxy/api/songs?page=2', { headers: { Cookie, Authorization: 'Bearer attacker-token' } }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('proxy rejects cross-origin writes and foreign redirects before leaking credentials', async () => {
  const Cookie = await loggedInCookie();
  const writes = mock.method(globalThis, 'fetch', () => { throw new Error('must not fetch'); });
  const rejected = await proxy({ env, params: { path: ['api', 'files', '1'] }, request: request('/ct-proxy/api/files/1', { method: 'DELETE', headers: { Cookie, Origin: 'https://evil.example' } }) });
  assert.equal(rejected.status, 403);
  assert.equal(writes.mock.callCount(), 0);
  mock.restoreAll();
  const redirects = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/download' } }));
  const response = await proxy({ env, params: { path: ['download'] }, request: request('/ct-proxy/download', { headers: { Cookie } }) });
  assert.equal(response.status, 502);
  assert.equal(redirects.mock.callCount(), 1);
});

test('same-origin uploads keep their method and multipart body', async () => {
  const Cookie = await loggedInCookie();
  const body = new FormData();
  body.append('files[]', new Blob(['#Title=Test\n---\nVers 1\nText']), 'test.sng');
  mock.method(globalThis, 'fetch', async (_target, init) => {
    assert.equal(init.method, 'POST');
    assert.match(init.headers.get('Content-Type'), /^multipart\/form-data; boundary=/);
    assert.match(await new Response(init.body).text(), /#Title=Test/);
    return Response.json({ data: [{ id: 1 }] });
  });
  const response = await proxy({ env, params: { path: ['api', 'files', 'song_arrangement', '1'] }, request: request('/ct-proxy/api/files/song_arrangement/1', { method: 'POST', headers: { Cookie, Origin: origin }, body }) });
  assert.equal(response.status, 200);
});
