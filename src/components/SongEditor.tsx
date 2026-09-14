import { useMemo } from 'react';
import type { Arrangement, ChurchToolsFile, Song } from '../api/churchtools';
import { parseSlides, validateSongDocument, type ParsedSongBeamer } from '../lib/songbeamer';
import SlidePreview from './SlidePreview';
import VerseOrderEditor from './VerseOrderEditor';

type Props = {
  song: Song;
  arrangement: Arrangement;
  file: ChurchToolsFile;
  document: ParsedSongBeamer;
  lyricsText: string;
  verseOrder: string[];
  dirty: boolean;
  saving: boolean;
  authenticated: boolean;
  onLyricsChange: (value: string) => void;
  onVerseOrderChange: (value: string[]) => void;
  onSave: () => void;
  onReload: () => void;
};

export default function SongEditor({
  song,
  arrangement,
  file,
  document,
  lyricsText,
  verseOrder,
  dirty,
  saving,
  authenticated,
  onLyricsChange,
  onVerseOrderChange,
  onSave,
  onReload,
}: Props) {
  const slides = useMemo(() => parseSlides(lyricsText), [lyricsText]);
  const labels = useMemo(() => [...new Set(slides.map((slide) => slide.label))].filter(Boolean), [slides]);
  const warnings = useMemo(() => validateSongDocument(lyricsText, verseOrder), [lyricsText, verseOrder]);

  return (
    <main className="editor-pane">
      <header className="editor-header">
        <div>
          <div className="breadcrumbs">{song.name} <span>›</span> {arrangement.name}</div>
          <h1>{document.title || song.name}</h1>
          <div className="file-summary">
            <span>{file.name}</span>
            <span>{slides.length} {slides.length === 1 ? 'Folie' : 'Folien'}</span>
            <span>{document.langCount} {document.langCount === 1 ? 'Sprache' : 'Sprachen'}</span>
          </div>
        </div>
        <div className="editor-actions">
          <button type="button" className="secondary" onClick={onReload} disabled={saving || !authenticated}>Neu laden</button>
          <button type="button" className="primary" onClick={onSave} disabled={saving || !dirty || !authenticated}>
            {saving ? 'Wird gespeichert …' : dirty ? 'In ChurchTools speichern' : 'Gespeichert'}
          </button>
        </div>
      </header>

      {warnings.length > 0 ? (
        <div className="warning-box">
          {warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      ) : null}

      <div className="editor-layout">
        <section className="editing-column">
          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">SongBeamer-Inhalt</span>
                <h2>Liedtext und Folien</h2>
              </div>
              <code>---</code>
            </div>
            <p className="panel-help">
              Trenne Folien mit <code>---</code> auf einer eigenen Zeile. Beginne einen Vers mit einer Markierung
              wie <code>Vers 1</code> oder <code>Refrain</code>. Eigene Namen sind mit <code>$$M=Name</code> möglich.
              Folien ohne Markierung gehören zum vorherigen Vers.
            </p>
            <textarea
              className="lyrics-editor"
              spellCheck
              value={lyricsText}
              onChange={(event) => onLyricsChange(event.target.value)}
              aria-label="Liedtext und Folienmarkierungen"
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Ablauf</span>
                <h2>Versreihenfolge</h2>
              </div>
              <span className="count-badge">{verseOrder.length}</span>
            </div>
            <VerseOrderEditor order={verseOrder} labels={labels} onChange={onVerseOrderChange} />
          </div>
        </section>

        <section className="preview-column">
          <div className="preview-sticky-heading">
            <div>
              <span className="eyebrow">Live-Ansicht</span>
              <h2>Folienvorschau</h2>
            </div>
            {document.langCount > 1 ? <span className="tag">Sprachen im Wechsel</span> : null}
          </div>
          <SlidePreview slides={slides} order={verseOrder} langCount={document.langCount} />
        </section>
      </div>
    </main>
  );
}
