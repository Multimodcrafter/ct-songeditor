import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSongBeamer, serializeSongBeamer, parseSlides, orderSlides, validateSongDocument, groupAlternatingLanguages } from '../src/lib/songbeamer.ts';

test('each verse-order occurrence expands every matching slide, including continuations', () => {
  const slides = parseSlides('Vers 1\nErste Zeile\n---\nZweite Zeile\n---\nRefrain\nRefraintext\n---\nVers 1\nDritte Zeile\n---\nVierte Zeile');
  assert.deepEqual(slides.map((slide) => slide.label), ['Vers 1', 'Vers 1', 'Refrain', 'Vers 1', 'Vers 1']);
  assert.deepEqual(orderSlides(slides, ['Vers 1', 'Refrain', 'Vers 1']).map((slide) => slide.lines[0]), [
    'Erste Zeile', 'Zweite Zeile', 'Dritte Zeile', 'Vierte Zeile', 'Refraintext',
    'Erste Zeile', 'Zweite Zeile', 'Dritte Zeile', 'Vierte Zeile',
  ]);
  assert.equal(new Set(slides.map((slide) => slide.id)).size, slides.length);
});

test('unlabeled initial slides retain all lyrics and file order', () => {
  const slides = parseSlides('Erste Liedzeile\nZweite Liedzeile\n---\nNoch eine Zeile');
  assert.deepEqual(slides.map((slide) => slide.label), ['', '']);
  assert.deepEqual(slides[0].lines, ['Erste Liedzeile', 'Zweite Liedzeile']);
  assert.deepEqual(orderSlides(slides, []), slides);
  assert.deepEqual(orderSlides(slides, ['Vers 1']), []);
  assert.match(validateSongDocument('Erste Liedzeile', ['Vers 1'])[0], /vor der ersten Versmarkierung/);
});

test('recognizes German, English, numbered, part and custom markers without swallowing lyrics', () => {
  for (const label of ['Vers 1a', 'Verse 2', 'Strophe 3', 'Chorus', 'Pre-Chorus 2', 'Teil A', 'Part B', 'Ostinato Refrain', 'Schluss']) {
    assert.equal(parseSlides(`${label}\nText`)[0].label, label);
  }
  const custom = parseSlides('$$M=Freier Name\nText\n---\nWeiterer Text');
  assert.deepEqual(custom.map((slide) => slide.label), ['Freier Name', 'Freier Name']);
  assert.deepEqual(custom[0].lines, ['Text']);
  assert.deepEqual(parseSlides('Verse of a song\nChorus of voices')[0].lines, ['Verse of a song', 'Chorus of voices']);
});

test('handles CRLF, blank blocks, whitespace and changing the previous verse', () => {
  const slides = parseSlides('\r\n Vers 1 \r\nText\r\n---\r\n\r\n---\r\nFortsetzung\r\n---\r\nRefrain\r\nText\r\n---\r\nNoch mehr');
  assert.deepEqual(slides.map((slide) => slide.label), ['Vers 1', 'Vers 1', 'Refrain', 'Refrain']);
  assert.deepEqual(slides[1].lines, ['Fortsetzung']);
});

test('duplicate verse labels are valid; missing labels still produce a warning', () => {
  const source = 'Refrain\nA\n---\nRefrain\nB';
  assert.deepEqual(validateSongDocument(source, ['Refrain', 'Refrain']), []);
  assert.match(validateSongDocument(source, ['Bridge'])[0], /fehlende Folien: Bridge/);
});

test('serialization preserves BOM, line endings, custom metadata and unmarked continuation text', () => {
  for (const bom of ['', '\ufeff']) for (const eol of ['\n', '\r\n']) {
    const text = bom + ['#Title=Beispiel', '#Custom=Unverändert', '#VerseOrder=Vers 1,Refrain', '---', 'Vers 1', 'Text', '---', 'Fortsetzung', '---', 'Refrain', 'Text', ''].join(eol);
    const original = new TextEncoder().encode(text);
    const doc = decodeSongBeamer(original.buffer);
    assert.deepEqual(serializeSongBeamer(doc, doc.lyricsText, doc.verseOrder), original);
    const changed = decodeSongBeamer(serializeSongBeamer(doc, doc.lyricsText, ['Refrain', 'Vers 1', 'Refrain']).buffer);
    assert.deepEqual(changed.verseOrder, ['Refrain', 'Vers 1', 'Refrain']);
    assert.equal(changed.lyricsText, doc.lyricsText);
    assert.ok(changed.metadataLines.includes('#Custom=Unverändert'));
    assert.equal(changed.hadUtf8Bom, Boolean(bom));
    assert.equal(changed.lineEnding, eol);
  }
});

test('multilingual lyrics remain in alternating groups with blank line spacers', () => {
  assert.deepEqual(groupAlternatingLanguages(['Deutsch', 'English', '', 'Noch eine Zeile'], 2), [['Deutsch', 'English'], [''], ['Noch eine Zeile']]);
});
