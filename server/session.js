export const CHURCHTOOLS_ORIGIN = 'https://nl.church.tools';
export const SESSION_COOKIE = 'ct_editor_session';
export const LOGIN_COOKIE = 'ct_editor_login';

export function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}

async function key(env) {
  if (typeof env.SESSION_SECRET !== 'string' || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function configured(env) {
  return Boolean(env.CHURCHTOOLS_CLIENT_ID?.trim() && env.SESSION_SECRET?.length >= 32);
}

export function randomValue() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challenge(verifier) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

export async function seal(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function readCookie(request, name, env) {
  const raw = (request.headers.get('Cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  try {
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(parts[0]) }, await key(env), decode(parts[1]));
    const value = JSON.parse(new TextDecoder().decode(decrypted));
    return Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}

export function cookie(request, name, value, maxAge) {
  if (value.length > 3800) throw new Error('Die Anmeldedaten sind zu groß.');
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function session(request, env) {
  const value = await readCookie(request, SESSION_COOKIE, env);
  return value?.purpose === 'session' && typeof value.accessToken === 'string' && value.accessToken ? value : null;
}
