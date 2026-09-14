const CHURCHTOOLS_ORIGIN = 'https://nl.church.tools';
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export async function onRequest(context) {
  const { request, params } = context;

  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: [...ALLOWED_METHODS].join(', ') },
    });
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Login ') || authorization.length <= 'Login '.length) {
    return new Response('A ChurchTools Login token is required.', { status: 401 });
  }

  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`/${path}`, CHURCHTOOLS_ORIGIN);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers();
  headers.set('Authorization', authorization);
  copyHeader(request.headers, headers, 'Accept');
  copyHeader(request.headers, headers, 'Accept-Language');
  copyHeader(request.headers, headers, 'Content-Type');

  const init = {
    method: request.method,
    headers,
    redirect: 'follow',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('Set-Cookie');
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    return new Response(`ChurchTools proxy error: ${message}`, { status: 502 });
  }
}

function copyHeader(source, target, name) {
  const value = source.get(name);
  if (value) target.set(name, value);
}
