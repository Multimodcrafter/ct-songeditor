export type MetadataEntry = {
  key: string;
  value: string;
  raw: string;
};

export type SonBeamerSlide = {
  id: string;
  label: string;
  lines: string[];
};

export type ParsedSonBeamer = {
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

export function decodeSonBeamer(bytes: ArrayBuffer): ParsedSonBeamer {
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

export function parseSlides(lyricsText: string): SonBeamerSlide[] {
  const normalized = lyricsText.replace(/\r\n/g, '\n');
  const chunks: string[][] = [[]];

  for (const line of normalized.split('\n')) {
    if (SLIDE_SEPARATOR.test(line)) {
      chunks.push([]);
    } else {
      chunks[chunks.length - 1].push(line);
    }
  }

  return chunks
    .map((lines, index) => {
      const firstContent = lines.findIndex((line) => line.trim().length > 0);
      if (firstContent < 0) return null;
      const label = lines[firstContent].trim();
      const body = lines.slice(firstContent + 1);
      while (body.length > 0 && body[body.length - 1] === '') body.pop();
      return {
        id: `${index}:${label}`,
        label,
        lines: body,
      } satisfies SonBeamerSlide;
    })
    .filter((slide): slide is SonBeamerSlide => slide !== null);
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

export function serializeSonBeamer(
  parsed: ParsedSonBeamer,
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
  if (!slides.length) warnings.push('No slides were found. Add a slide label and lyrics.');

  const labels = slides.map((slide) => slide.label);
  const duplicateLabels = labels.filter((label, index) => labels.indexOf(label) !== index);
  if (duplicateLabels.length) {
    warnings.push(`Duplicate slide labels: ${[...new Set(duplicateLabels)].join(', ')}`);
  }

  const missing = verseOrder.filter((label) => !labels.includes(label));
  if (missing.length) {
    warnings.push(`Verse order references missing slides: ${[...new Set(missing)].join(', ')}`);
  }
  return warnings;
}
