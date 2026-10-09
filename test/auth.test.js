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
    assert.equal(options.redirect, 'manual');
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

test('callback rejects token endpoint redirects without forwarding credentials', async () => {
  const { loginCookie, url } = await start();
  const logs = mock.method(console, 'error', () => {});
  const calls = mock.method(globalThis, 'fetch', async (target, options) => {
    assert.equal(target, `${CHURCHTOOLS_ORIGIN}/oauth/access_token`);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 307, headers: { Location: 'https://evil.example/token' } });
  });
  const response = await auth({ env, request: request(`/auth/callback?code=x&state=${url.searchParams.get('state')}`, { headers: { Cookie: loginCookie } }) });
  assert.equal(response.headers.get('Location'), '/?auth_error=exchange_failed');
  assert.equal(cookiePair(response, SESSION_COOKIE), undefined);
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(JSON.parse(logs.mock.calls[0].arguments[1]).upstream.status, 307);
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

test('callback logs every failure with upstream diagnostics and redacts credentials', async () => {
  const { loginCookie, url } = await start();
  const state = url.searchParams.get('state');
  const logs = mock.method(console, 'error', () => {});
  let upstream;
  mock.method(globalThis, 'fetch', async () => {
    if (upstream instanceof Error) throw upstream;
    return upstream;
  });
  const invoke = (query, config = env) => auth({
    env: config,
    request: request(`/auth/callback?${query}`, { headers: { Cookie: loginCookie } }),
  });
  const lastLog = () => JSON.parse(logs.mock.calls.at(-1).arguments[1]);
  await invoke('', {});
  assert.equal(lastLog().error, 'configuration');
  await invoke('state=wrong&code=secret-code');
  assert.equal(lastLog().stateMatches, false);
  await invoke(`state=${state}`);
  assert.equal(lastLog().codePresent, false);
  await invoke(`state=${state}&error=access_denied&error_description=Consent+refused`);
  assert.equal(lastLog().providerDescription, 'Consent refused');

  for (const [body, status, expected] of [
    ['<html>CT unavailable</html>', 502, 'exchange_failed'],
    ['{"error":"invalid_grant","error_description":"secret-code rejected"}', 400, 'exchange_failed'],
    ['not JSON', 200, 'exchange_failed'],
    ['{"access_token":"private-token","refresh_token":"private-refresh","scope":"profile"}', 200, 'invalid_token'],
  ]) {
    upstream = new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
    const response = await invoke(`state=${state}&code=secret-code`);
    assert.equal(response.headers.get('Location'), `/?auth_error=${expected}`);
    const log = lastLog();
    assert.equal(log.error, expected);
    assert.equal(log.upstream.status, status);
    assert.equal(log.upstream.contentType, 'text/plain');
    assert.equal(log.upstream.body, body.replaceAll('secret-code', '[redacted]').replaceAll('private-token', '[redacted]').replaceAll('private-refresh', '[redacted]'));
    assert.doesNotMatch(logs.mock.calls.at(-1).arguments[1], /secret-code|private-token|private-refresh/);
  }
  upstream = new Error('CT connection failed');
  await invoke(`state=${state}&code=secret-code`);
  assert.deepEqual(lastLog().exception, { name: 'Error', message: 'CT connection failed' });
  assert.equal(lastLog().upstream, undefined);
  assert.equal(logs.mock.callCount(), 9);
});

test('legacy downloads retry with the current user Login token kept server-side', async () => {
  const Cookie = await loggedInCookie();
  const query = '?q=public%2Ffiledownload&id=7&filename=hash';
  const calls = mock.method(globalThis, 'fetch', async (target, init) => {
    const count = calls.mock.callCount() + 1;
    assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('Cookie'), null);
    if (count <= 3) assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer private-access-token');
    if (count === 1) {
      assert.equal(String(target), `${CHURCHTOOLS_ORIGIN}/${query}`);
      return new Response('Insufficient permission. You need the permission "song_arrangement".', { status: 401 });
    }
    if (count === 2) {
      assert.equal(String(target), `${CHURCHTOOLS_ORIGIN}/api/whoami?only_allow_authenticated=true`);
      return Response.json({ data: { id: 42 } });
    }
    if (count === 3) {
      assert.equal(String(target), `${CHURCHTOOLS_ORIGIN}/api/persons/42/logintoken`);
      return Response.json({ data: 'private-login-token' });
    }
    assert.equal(count, 4);
    assert.equal(String(target), `${CHURCHTOOLS_ORIGIN}/${query}`);
    assert.equal(init.headers.get('Authorization'), 'Login private-login-token');
    return new Response('#Title=Test\n---\nLyrics', { headers: { 'Set-Cookie': 'ct=private' } });
  });
  const response = await proxy({ env, params: { path: [] }, request: request(`/ct-proxy/${query}`, { headers: { Cookie } }) });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '#Title=Test\n---\nLyrics');
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(calls.mock.callCount(), 4);
});

test('legacy download credential failures and redirects fail closed', async () => {
  const Cookie = await loggedInCookie();
  for (const [identity, credential, retry, status, count] of [
    [new Response(null, { status: 401 }), null, null, 401, 2],
    [new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), null, null, 502, 2],
    [Response.json({ data: { id: '../other' } }), null, null, 502, 2],
    [Response.json({ data: { id: 42 } }), new Response(null, { status: 403 }), null, 403, 3],
    [Response.json({ data: { id: 42 } }), new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), null, 502, 3],
    [Response.json({ data: { id: 42 } }), Response.json({ data: 'bad\ntoken' }), null, 502, 3],
    [Response.json({ data: { id: 42 } }), Response.json({ data: 'private-login-token' }), new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }), 502, 4],
    [Response.json({ data: { id: 42 } }), Response.json({ data: 'private-login-token' }), new Response('Still denied', { status: 403 }), 403, 4],
  ]) {
    const responses = [new Response('Permission denied', { status: 403 }), identity, credential, retry];
    const calls = mock.method(globalThis, 'fetch', async (target) => {
      assert.equal(new URL(target).origin, CHURCHTOOLS_ORIGIN);
      return responses.shift();
    });
    const response = await proxy({ env, params: { path: [] }, request: request('/ct-proxy/?q=public/filedownload&id=7&filename=hash', { headers: { Cookie } }) });
    assert.equal(response.status, status);
    assert.equal(calls.mock.callCount(), count);
    assert.doesNotMatch(await response.text(), /private-login-token|private-access-token/);
    mock.restoreAll();
  }
});

test('ordinary API authorization failures do not request a Login token', async () => {
  const Cookie = await loggedInCookie();
  const calls = mock.method(globalThis, 'fetch', async () => new Response('Unauthorized', { status: 401 }));
  const response = await proxy({ env, params: { path: ['api', 'songs'] }, request: request('/ct-proxy/api/songs', { headers: { Cookie } }) });
  assert.equal(response.status, 401);
  assert.equal(calls.mock.callCount(), 1);
});
