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
  const secrets = [env.CHURCHTOOLS_CLIENT_SECRET, env.SESSION_SECRET,
    ...url.searchParams.getAll('code'), ...url.searchParams.getAll('state')];
  let upstream;
  const headers = new Headers({
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': cookie(request, LOGIN_COOKIE, '', 0),
  });
  function finish(error, details = {}) {
    if (error) {
      const diagnostic = JSON.stringify({ error, ...details, upstream }, (key, value) => {
        if (/^(access_token|refresh_token|id_token|client_secret|code_verifier)$/i.test(key)) return '[redacted]';
        if (typeof value !== 'string') return value;
        let text = value.replace(/("(?:access_token|refresh_token|id_token|client_secret|code_verifier)"\s*:\s*")((?:\\.|[^"\\])*)("|$)/gi, '$1[redacted]$3');
        for (const secret of secrets) {
          if (secret) text = text.replaceAll(secret, '[redacted]');
        }
        return text;
      });
      console.error('ChurchTools OAuth callback failed', diagnostic);
    }
    headers.set('Location', error ? `/?auth_error=${error}` : '/');
    return new Response(null, { status: 303, headers });
  }
  if (!configured(env)) return finish('configuration', {
    clientIdConfigured: Boolean(env.CHURCHTOOLS_CLIENT_ID?.trim()),
    sessionSecretConfigured: Boolean(env.SESSION_SECRET?.length >= 32),
  });
  const pending = await readCookie(request, LOGIN_COOKIE, env);
  secrets.push(pending?.state, pending?.verifier);
  if (pending?.purpose !== 'login' || url.searchParams.getAll('state').length !== 1
    || pending.state !== url.searchParams.get('state')
    || pending.redirectUri !== new URL('/auth/callback', url.origin).href) return finish('invalid_state', {
    validLoginCookie: pending?.purpose === 'login',
    stateCount: url.searchParams.getAll('state').length,
    stateMatches: pending?.state === url.searchParams.get('state'),
    redirectUriMatches: pending?.redirectUri === new URL('/auth/callback', url.origin).href,
  });
  if (url.searchParams.has('error')) return finish('denied', {
    providerError: url.searchParams.get('error'),
    providerDescription: url.searchParams.get('error_description'),
  });
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1) return finish('invalid_state', {
    codePresent: Boolean(code), codeCount: url.searchParams.getAll('code').length,
  });

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: env.CHURCHTOOLS_CLIENT_ID.trim(),
      code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier,
    });
    if (env.CHURCHTOOLS_CLIENT_SECRET) body.set('client_secret', env.CHURCHTOOLS_CLIENT_SECRET);
    const response = await fetch(`${CHURCHTOOLS_ORIGIN}/oauth/access_token`, {
      method: 'POST', headers: { Accept: 'application/json' }, body,
      redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    upstream = { status: response.status, statusText: response.statusText, contentType: response.headers.get('Content-Type') };
    upstream.body = await response.text();
    if (!response.ok) return finish('exchange_failed');
    const token = JSON.parse(upstream.body);
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
  } catch (error) {
    return finish('exchange_failed', { exception: { name: error?.name, message: error?.message } });
  }
}
