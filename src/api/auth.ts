export type AuthSession = { authenticated: boolean; configured: boolean };

async function authRequest(path: string, method = 'GET') {
  const response = await fetch(`/auth/${path}`, { method, credentials: 'same-origin' });
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error('Die Anmeldung ist derzeit nicht erreichbar. Bitte versuche es erneut.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Die Anmeldung konnte nicht abgeschlossen werden.');
  return data;
}

export function getSession(): Promise<AuthSession> {
  return authRequest('session');
}

export async function login() {
  const data = await authRequest('login', 'POST');
  window.location.assign(data.url);
}

export async function logout() {
  await authRequest('logout', 'POST');
}

export function consumeAuthError(): string | null {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('auth_error');
  if (!error) return null;
  url.searchParams.delete('auth_error');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  const messages: Record<string, string> = {
    configuration: 'Die ChurchTools-Anmeldung ist noch nicht eingerichtet. Bitte wende dich an die Administration.',
    invalid_state: 'Die Anmeldung ist abgelaufen oder ungültig. Bitte starte sie erneut.',
    denied: 'Die Anmeldung wurde abgebrochen oder von ChurchTools nicht erlaubt.',
    exchange_failed: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut.',
    invalid_token: 'ChurchTools hat keinen gültigen API-Zugriff erteilt. Bitte wende dich an die Administration.',
  };
  return messages[error] ?? 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.';
}
