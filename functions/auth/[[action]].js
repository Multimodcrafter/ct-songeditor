import {
  CHURCHTOOLS_ORIGIN, SESSION_COOKIE, LOGIN_COOKIE, json, sameOrigin,
  configured, randomValue, challenge, seal, readCookie, cookie, session,
} from '../../server/session.js';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const action = url.pathname.replace(/\/$/, '').split('/').pop();
  if (action === 'session' && request.method === 'GET') {
    const current = await session(request, env);
    return json({ authenticated: Boolean(current), configured: configured(env) });
  }
  if (action === 'callback' && request.method === 'GET') return callback(request, env);
  if (!['login', 'logout'].includes(action)) return json({ error: 'Nicht gefunden.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Methode nicht erlaubt.' }, 405, { Allow: 'POST' });
  if (!sameOrigin(request)) return json({ error: 'Anfrage von einer fremden Webseite abgelehnt.' }, 403);
  if (action === 'logout') {
    const response = json({ authenticated: false });
    response.headers.append('Set-Cookie', cookie(request, SESSION_COOKIE, '', 0));
    response.headers.append('Set-Cookie', cookie(request, LOGIN_COOKIE, '', 0));
    return response;
  }
  if (!configured(env)) return json({ error: 'Die ChurchTools-Anmeldung ist noch nicht eingerichtet. Bitte wende dich an die Administration.' }, 503);

  const state = randomValue();
  const verifier = randomValue();
  const redirectUri = new URL('/auth/callback', url.origin).href;
  const authorization = new URL('/oauth/authorize', CHURCHTOOLS_ORIGIN);
  authorization.search = new URLSearchParams({
    response_type: 'code', client_id: env.CHURCHTOOLS_CLIENT_ID.trim(),
    redirect_uri: redirectUri, scope: 'api', state,
    code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  }).toString();
  const pending = await seal({ purpose: 'login', state, verifier, redirectUri, expiresAt: Date.now() + 600_000 }, env);
  return json({ url: authorization.href }, 200, { 'Set-Cookie': cookie(request, LOGIN_COOKIE, pending, 600) });
}

async function callback(request, env) {
  const url = new URL(request.url);
  const headers = new Headers({
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': cookie(request, LOGIN_COOKIE, '', 0),
  });
  function finish(error) {
    headers.set('Location', error ? `/?auth_error=${error}` : '/');
    return new Response(null, { status: 303, headers });
  }
  if (!configured(env)) return finish('configuration');
  const pending = await readCookie(request, LOGIN_COOKIE, env);
  if (pending?.purpose !== 'login' || url.searchParams.getAll('state').length !== 1
    || pending.state !== url.searchParams.get('state')
    || pending.redirectUri !== new URL('/auth/callback', url.origin).href) return finish('invalid_state');
  if (url.searchParams.has('error')) return finish('denied');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1) return finish('invalid_state');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: env.CHURCHTOOLS_CLIENT_ID.trim(),
      code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier,
    });
    if (env.CHURCHTOOLS_CLIENT_SECRET) body.set('client_secret', env.CHURCHTOOLS_CLIENT_SECRET);
    const response = await fetch(`${CHURCHTOOLS_ORIGIN}/oauth/access_token`, {
      method: 'POST', headers: { Accept: 'application/json' }, body,
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return finish('exchange_failed');
    const token = await response.json();
    const lifetime = Math.min(Number(token.expires_in ?? 3600), 8 * 60 * 60);
    if (typeof token.access_token !== 'string' || !token.access_token || /\s/.test(token.access_token)
      || !Number.isFinite(lifetime) || lifetime <= 0
      || (token.token_type && token.token_type.toLowerCase() !== 'bearer')
      || (token.scope !== undefined && (typeof token.scope !== 'string' || !token.scope.split(/\s+/).includes('api')))) {
      return finish('invalid_token');
    }
    const value = await seal({ purpose: 'session', accessToken: token.access_token, expiresAt: Date.now() + lifetime * 1000 }, env);
    headers.append('Set-Cookie', cookie(request, SESSION_COOKIE, value, Math.floor(lifetime)));
    return finish();
  } catch {
    return finish('exchange_failed');
  }
}
