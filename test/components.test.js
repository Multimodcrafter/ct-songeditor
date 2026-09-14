import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' });
});
after(async () => { await vite?.close(); });

async function render(name, props) {
  const component = await vite.ssrLoadModule(`/src/components/${name}.tsx`);
  return renderToStaticMarkup(createElement(component.default, props));
}

test('verse rows are dropdowns with distinct labels and visible missing references', async () => {
  const html = await render('VerseOrderEditor', { order: ['Refrain', 'Entfernt'], labels: ['Vers 1', 'Refrain', 'Refrain', ''], onChange() {} });
  assert.equal((html.match(/<select\b/g) ?? []).length, 2);
  assert.equal((html.match(/<option value="Refrain"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<input|<datalist/);
  assert.match(html, /Entfernt \(fehlt\)/);
  assert.match(html, /Nach oben/);
  assert.match(html, /Vers hinzufügen/);
});

test('adding a verse is disabled when there are no labels', async () => {
  const html = await render('VerseOrderEditor', { order: [], labels: [], onChange() {} });
  assert.match(html, /<button[^>]*disabled=""[^>]*>\+ Vers hinzufügen/);
  assert.match(html, /Reihenfolge in der Datei/);
});

test('the rendered preview repeats complete groups with translated labels', async () => {
  const { parseSlides } = await vite.ssrLoadModule('/src/lib/songbeamer.ts');
  const html = await render('SlidePreview', {
    slides: parseSlides('Refrain\nErster Text\n---\nFortsetzung\n---\nRefrain\nDritter Text'),
    order: ['Refrain', 'Refrain'], langCount: 1,
  });
  assert.equal((html.match(/class="slide-card"/g) ?? []).length, 6);
  assert.equal((html.match(/Fortsetzung/g) ?? []).length, 2);
  assert.match(html, /Folie 6/);
});

test('connection panel exposes OAuth actions and no credential input', async () => {
  const props = { authenticated: false, configured: true, busy: false, onLogin() {}, onLogout() {} };
  const html = await render('ConnectionPanel', props);
  assert.match(html, /Mit ChurchTools anmelden/);
  assert.doesNotMatch(html, /<input/);
  assert.match(await render('ConnectionPanel', { ...props, authenticated: true }), /Abmelden/);
  assert.match(await render('ConnectionPanel', { ...props, configured: false }), /Die Anmeldung wird noch eingerichtet/);
});
