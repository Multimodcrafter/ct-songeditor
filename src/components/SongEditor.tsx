import { useMemo } from 'react';
import type { Arrangement, ChurchToolsFile, Song } from '../api/churchtools';
import { parseSlides, validateSongDocument, type ParsedSonBeamer } from '../lib/sonbeamer';
import SlidePreview from './SlidePreview';
import VerseOrderEditor from './VerseOrderEditor';

type Props = {
  song: Song;
  arrangement: Arrangement;
  file: ChurchToolsFile;
  document: ParsedSonBeamer;
  lyricsText: string;
  verseOrder: string[];
  dirty: boolean;
  saving: boolean;
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
  onLyricsChange,
  onVerseOrderChange,
  onSave,
  onReload,
}: Props) {
  const slides = useMemo(() => parseSlides(lyricsText), [lyricsText]);
  const labels = useMemo(() => slides.map((slide) => slide.label), [slides]);
  const warnings = useMemo(() => validateSongDocument(lyricsText, verseOrder), [lyricsText, verseOrder]);

  return (
    <main className="editor-pane">
      <header className="editor-header">
        <div>
          <div className="breadcrumbs">{song.name} <span>›</span> {arrangement.name}</div>
          <h1>{document.title || song.name}</h1>
          <div className="file-summary">
            <span>{file.name}</span>
            <span>{slides.length} slide{slides.length === 1 ? '' : 's'}</span>
            <span>{document.langCount} language{document.langCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="editor-actions">
          <button type="button" className="secondary" onClick={onReload} disabled={saving}>Reload</button>
          <button type="button" className="primary" onClick={onSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save to ChurchTools' : 'Saved'}
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
                <span className="eyebrow">SonBeamer body</span>
                <h2>Lyrics & slides</h2>
              </div>
              <code>---</code>
            </div>
            <p className="panel-help">
              The first line of each block is its label. Put <code>---</code> on its own line to start the next slide.
            </p>
            <textarea
              className="lyrics-editor"
              spellCheck
              value={lyricsText}
              onChange={(event) => onLyricsChange(event.target.value)}
              aria-label="Song lyrics and slide markers"
            />
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Playback sequence</span>
                <h2>Verse order</h2>
              </div>
              <span className="count-badge">{verseOrder.length}</span>
            </div>
            <VerseOrderEditor order={verseOrder} labels={labels} onChange={onVerseOrderChange} />
          </div>
        </section>

        <section className="preview-column">
          <div className="preview-sticky-heading">
            <div>
              <span className="eyebrow">Live rendering</span>
              <h2>Slide preview</h2>
            </div>
            {document.langCount > 1 ? <span className="tag">Alternating languages</span> : null}
          </div>
          <SlidePreview slides={slides} order={verseOrder} langCount={document.langCount} />
        </section>
      </div>
    </main>
  );
}
