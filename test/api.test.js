import assert from 'node:assert/strict';
import { after, afterEach, before, mock, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let ChurchToolsApi;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
  ({ ChurchToolsApi } = await vite.ssrLoadModule('/src/api/churchtools.ts'));
});
after(async () => { await vite?.close(); });
afterEach(() => mock.restoreAll());

const file = { name: 'Song.sng', fileUrl: 'https://nl.church.tools/?q=public%2Ffiledownload&id=1&filename=hash' };

test('downloads keep the legacy URL and send the editor session cookie', async () => {
  const calls = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/ct-proxy/?q=public%2Ffiledownload&id=1&filename=hash');
    assert.equal(options.credentials, 'same-origin');
    return new Response('#Title=Test\n---\nText');
  });
  const bytes = await new ChurchToolsApi().downloadFile(file);
  assert.equal(new TextDecoder().decode(bytes), '#Title=Test\n---\nText');
  assert.equal(calls.mock.callCount(), 1);
});

test('download rejection only expires the session when the authenticated API also returns 401', async () => {
  for (const status of [200, 401, 503]) {
    const expired = mock.fn();
    const calls = mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.credentials, 'same-origin');
      if (url.startsWith('/ct-proxy/?')) return new Response('Download denied', { status: 401 });
      assert.equal(url, '/ct-proxy/api/whoami?only_allow_authenticated=true');
      return Response.json({ data: { id: 1 } }, { status });
    });
    await assert.rejects(new ChurchToolsApi(expired).downloadFile(file), status === 401 ? /Anmeldung ist abgelaufen/ : status === 200 ? /ChurchTools: Download denied/ : /Status 503/);
    assert.equal(expired.mock.callCount(), status === 401 ? 1 : 0);
    assert.equal(calls.mock.callCount(), 2);
    mock.restoreAll();
  }
});
