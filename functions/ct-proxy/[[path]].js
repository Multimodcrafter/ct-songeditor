import { CHURCHTOOLS_ORIGIN, json, sameOrigin, session } from '../../server/session.js';
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export async function onRequest(context) {
  const { request, params, env } = context;

  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response('Methode nicht erlaubt.', {
      status: 405,
      headers: { Allow: [...ALLOWED_METHODS].join(', ') },
    });
  }

  if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) {
    return json({ error: 'Anfrage von einer fremden Webseite abgelehnt.' }, 403);
  }
  const current = await session(request, env);
  if (!current) return json({ error: 'Bitte melde dich bei ChurchTools an.' }, 401);

  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/${path}`, CHURCHTOOLS_ORIGIN);
  if (targetUrl.origin !== CHURCHTOOLS_ORIGIN) return json({ error: 'Ungültiges Downloadziel.' }, 400);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers();
  headers.set('Authorization', `Bearer ${current.accessToken}`);
  copyHeader(request.headers, headers, 'Accept');
  copyHeader(request.headers, headers, 'Accept-Language');
  copyHeader(request.headers, headers, 'Content-Type');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  try {
    let upstream = await fetch(targetUrl, init);
    if ([401, 403].includes(upstream.status) && ['GET', 'HEAD'].includes(request.method)
      && targetUrl.pathname === '/' && targetUrl.searchParams.get('q') === 'public/filedownload') {
      // The legacy download route may not recognize OAuth Bearer authentication.
      const apiInit = { headers: { Authorization: `Bearer ${current.accessToken}`, Accept: 'application/json' }, redirect: 'manual' };
      const identity = await fetch(`${CHURCHTOOLS_ORIGIN}/api/whoami?only_allow_authenticated=true`, apiInit);
      if (!identity.ok) return json({ error: 'ChurchTools konnte die Anmeldung für den Download nicht bestätigen.' }, identity.status === 401 ? 401 : 502);
      const personId = (await identity.json()).data?.id;
      if (!Number.isSafeInteger(personId) || personId <= 0) throw new Error('Invalid ChurchTools person ID');
      const credential = await fetch(`${CHURCHTOOLS_ORIGIN}/api/persons/${personId}/logintoken`, apiInit);
      if (!credential.ok) return json({ error: 'ChurchTools konnte den Dateizugriff nicht autorisieren.' }, credential.status === 401 ? 401 : credential.status === 403 ? 403 : 502);
      const loginToken = (await credential.json()).data;
      if (typeof loginToken !== 'string' || !loginToken || /\s/.test(loginToken)) throw new Error('Invalid ChurchTools login token');
      headers.set('Authorization', `Login ${loginToken}`);
      await upstream.body?.cancel();
      upstream = await fetch(targetUrl, init);
    }
    let currentUrl = targetUrl;
    for (let redirects = 0; upstream.status >= 300 && upstream.status < 400 && upstream.headers.has('Location'); redirects++) {
      const next = new URL(upstream.headers.get('Location'), currentUrl);
      if (next.origin !== CHURCHTOOLS_ORIGIN || redirects >= 4 || !['GET', 'HEAD'].includes(request.method)) {
        console.error('ChurchTools proxy redirect rejected', {
          reason: next.origin !== CHURCHTOOLS_ORIGIN ? 'foreign_origin' : redirects >= 4 ? 'redirect_limit' : 'unsafe_method',
          status: upstream.status,
          method: request.method,
          fromOrigin: currentUrl.origin,
          toOrigin: next.origin,
          redirectsFollowed: redirects,
          sameUrl: next.href === currentUrl.href,
          setsCookie: upstream.headers.has('Set-Cookie'),
        });
        return json({ error: 'Unsichere Weiterleitung von ChurchTools abgelehnt.' }, 502);
      }
      currentUrl = next;
      upstream = await fetch(currentUrl, init);
    }
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('Set-Cookie');
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return json({ error: 'ChurchTools ist derzeit nicht erreichbar. Bitte versuche es erneut.' }, 502);
  }
}

function copyHeader(source, target, name) {
  const value = source.get(name);
  if (value) target.set(name, value);
}
