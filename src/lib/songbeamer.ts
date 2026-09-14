export type MetadataEntry = {
  key: string;
  value: string;
  raw: string;
};

export type SongBeamerSlide = {
  id: string;
  label: string;
  lines: string[];
};

export type ParsedSongBeamer = {
  metadataLines: string[];
  metadata: MetadataEntry[];
  lyricsText: string;
  verseOrder: string[];
  langCount: number;
  title: string;
  hadUtf8Bom: boolean;
  lineEnding: '\n' | '\r\n';
};

const SLIDE_SEPARATOR = /^---\s*$/;

function metadataValue(lines: string[], key: string): string | undefined {
  const prefix = `#${key}=`.toLowerCase();
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(prefix));
  return line?.slice(line.indexOf('=') + 1);
}

function parseMetadata(lines: string[]): MetadataEntry[] {
  return lines
    .filter((line) => line.startsWith('#') && line.includes('='))
    .map((raw) => {
      const equals = raw.indexOf('=');
      return {
        key: raw.slice(1, equals),
        value: raw.slice(equals + 1),
        raw,
      };
    });
}

export function decodeSongBeamer(bytes: ArrayBuffer): ParsedSongBeamer {
  const raw = new Uint8Array(bytes);
  const hadUtf8Bom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const text = new TextDecoder('utf-8').decode(raw);
  const lineEnding: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstSeparator = lines.findIndex((line) => SLIDE_SEPARATOR.test(line));

  const metadataLines = firstSeparator >= 0 ? lines.slice(0, firstSeparator) : [];
  const lyricsLines = firstSeparator >= 0 ? lines.slice(firstSeparator + 1) : lines;
  const lyricsText = lyricsLines.join('\n').replace(/\n+$/, '');

  const orderRaw = metadataValue(metadataLines, 'VerseOrder') ?? '';
  const langCountRaw = metadataValue(metadataLines, 'LangCount') ?? '1';
  const parsedLangCount = Number.parseInt(langCountRaw, 10);

  return {
    metadataLines,
    metadata: parseMetadata(metadataLines),
    lyricsText,
    verseOrder: orderRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    langCount: Number.isFinite(parsedLangCount) && parsedLangCount > 0 ? parsedLangCount : 1,
    title: metadataValue(metadataLines, 'Title') ?? '',
    hadUtf8Bom,
    lineEnding,
  };
}

// SongBeamer's built-in verse markers; arbitrary names use $$M=Name.
const VERSE_MARKER = /^(?:(?:Intro|Vers|Verse|Strophe|Pre-Bridge|Bridge|Misc|Pre-Refrain|Refrain|Pre-Chorus|Chorus|Pre-Coda|Zwischenspiel|Instrumental|Interlude|Coda|Ending|Ende|Outro|Chor|Solo|Breakdown|Vamp|Turnaround|Tag|Andere|Mittelteil|Schluss|Gesprochen|Oberstimme|Schluss-Chorus|Post-Chorus|Mid-Section|Rap|Spoken Words|Ostinato Refrain|Descant|Unbekannt|Unbenannt|Unknown|Hidden|Invisible|Comment|Title|Copyright)(?: \d+[a-z]?)?|(?:Teil|Part)(?: (?:\d+[a-z]?|[A-Z]))?)$/i;

export function parseSlides(lyricsText: string): SongBeamerSlide[] {
  const normalized = lyricsText.replace(/\r\n/g, '\n');
  const chunks: string[][] = [[]];

  for (const line of normalized.split('\n')) {
    if (SLIDE_SEPARATOR.test(line)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }

  let previousLabel = '';
  return chunks
    .map((lines, index) => {
      const firstContent = lines.findIndex((line) => line.trim().length > 0);
      if (firstContent < 0) return null;
      const firstLine = lines[firstContent].trim();
      const customLabel = firstLine.startsWith('$$M=') ? firstLine.slice(4).trim() : '';
      const explicitLabel = customLabel || (VERSE_MARKER.test(firstLine) ? firstLine : '');
      const label = explicitLabel || previousLabel;
      if (explicitLabel) previousLabel = explicitLabel;
      // A continuation starts with lyrics: keep its first line intact.
      const body = lines.slice(explicitLabel ? firstContent + 1 : firstContent);
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      return {
        id: `${index}:${label}`,
        label,
        lines: body,
      } satisfies SongBeamerSlide;
    })
    .filter((slide): slide is SongBeamerSlide => slide !== null);
}

export function orderSlides(slides: SongBeamerSlide[], order: string[]): SongBeamerSlide[] {
  if (!order.length) return slides;
  const byLabel = new Map<string, SongBeamerSlide[]>();
  for (const slide of slides) {
    const group = byLabel.get(slide.label) ?? [];
    group.push(slide);
    byLabel.set(slide.label, group);
  }
  return order.flatMap((label) => byLabel.get(label) ?? []);
}

export function groupAlternatingLanguages(lines: string[], langCount: number): string[][] {
  const safeCount = Math.max(1, Math.floor(langCount));
  const groups: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line === '') {
      if (current.length) groups.push(current);
      groups.push(['']);
      current = [];
      continue;
    }
    current.push(line);
    if (current.length === safeCount) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function upsertMetadata(lines: string[], key: string, value: string): string[] {
  const prefix = `#${key}=`.toLowerCase();
  const next = [...lines];
  const index = next.findIndex((line) => line.toLowerCase().startsWith(prefix));
  const replacement = `#${key}=${value}`;
  if (index >= 0) next[index] = replacement;
  else next.push(replacement);
  return next;
}

export function serializeSongBeamer(
  parsed: ParsedSongBeamer,
  lyricsText: string,
  verseOrder: string[],
): Uint8Array<ArrayBuffer> {
  let metadataLines = [...parsed.metadataLines];
  metadataLines = upsertMetadata(metadataLines, 'VerseOrder', verseOrder.join(','));

  const normalizedLyrics = lyricsText.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  const normalized = [...metadataLines, '---', normalizedLyrics, ''].join('\n');
  const text = normalized.replace(/\n/g, parsed.lineEnding);
  const encoded = new TextEncoder().encode(text);

  if (!parsed.hadUtf8Bom) return encoded;
  const withBom = new Uint8Array(encoded.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(encoded, 3);
  return withBom;
}

export function validateSongDocument(lyricsText: string, verseOrder: string[]): string[] {
  const slides = parseSlides(lyricsText);
  const warnings: string[] = [];
  if (!slides.length) warnings.push('Keine Folien gefunden. Füge eine Versmarkierung und Liedtext hinzu.');

  const labels = slides.map((slide) => slide.label);
  if (verseOrder.length && slides.some((slide) => !slide.label)) {
    warnings.push('Folien vor der ersten Versmarkierung haben keine Zuordnung und werden bei einer festgelegten Versreihenfolge nicht angezeigt.');
  }

  const missing = verseOrder.filter((label) => !labels.includes(label));
  if (missing.length) {
    warnings.push(`Versreihenfolge verweist auf fehlende Folien: ${[...new Set(missing)].join(', ')}`);
  }
  return warnings;
}
