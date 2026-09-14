import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChurchToolsApi,
  isSngFile,
  newestFile,
  type Arrangement,
  type ChurchToolsFile,
  type Song,
} from './api/churchtools';
import ConnectionPanel, { type ConnectionValues } from './components/ConnectionPanel';
import SongBrowser from './components/SongBrowser';
import SongEditor from './components/SongEditor';
import { decodeSonBeamer, serializeSonBeamer, type ParsedSonBeamer } from './lib/sonbeamer';

type EditorState = {
  file: ChurchToolsFile;
  document: ParsedSonBeamer;
  lyricsText: string;
  verseOrder: string[];
  originalLyricsText: string;
  originalVerseOrder: string[];
};

const initialToken = sessionStorage.getItem('churchtools-login-token') || '';

export default function App() {
  const [connection, setConnection] = useState<ConnectionValues>({
    loginToken: initialToken,
  });
  const [api, setApi] = useState(() => new ChurchToolsApi(connection));
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [arrangements, setArrangements] = useState<Arrangement[]>([]);
  const [selectedArrangement, setSelectedArrangement] = useState<Arrangement | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [filter, setFilter] = useState('');
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingArrangements, setLoadingArrangements] = useState(false);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messageTimer = useRef<number | null>(null);

  const dirty = Boolean(
    editor &&
      (editor.lyricsText !== editor.originalLyricsText ||
        editor.verseOrder.join('\u0000') !== editor.originalVerseOrder.join('\u0000')),
  );

  const filteredSongs = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return songs;
    return songs.filter((song) => {
      const haystack = [song.name, song.author, song.category?.name, song.category?.nameTranslated]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return haystack.includes(query);
    });
  }, [filter, songs]);

  useEffect(() => {
    if (initialToken) void loadSongs(api);
    return () => {
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    };
    // Initial load intentionally uses the restored connection settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function notify(text: string) {
    setMessage(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 3500);
  }

  async function loadSongs(client = api) {
    setLoadingSongs(true);
    setError(null);
    try {
      const loaded = await client.getSongs();
      setSongs(loaded);
      if (selectedSong) {
        const updatedSelected = loaded.find((song) => song.id === selectedSong.id) ?? null;
        setSelectedSong(updatedSelected);
      }
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingSongs(false);
    }
  }

  async function connect(values: ConnectionValues) {
    const normalized: ConnectionValues = {
      loginToken: values.loginToken.trim(),
    };
    if (normalized.loginToken) sessionStorage.setItem('churchtools-login-token', normalized.loginToken);
    else sessionStorage.removeItem('churchtools-login-token');

    const client = new ChurchToolsApi(normalized);
    setConnection(normalized);
    setApi(client);
    setSelectedSong(null);
    setSelectedArrangement(null);
    setArrangements([]);
    setEditor(null);
    await loadSongs(client);
  }

  async function selectSong(song: Song) {
    if (dirty && !window.confirm('Discard unsaved song changes?')) return;
    setSelectedSong(song);
    setSelectedArrangement(null);
    setEditor(null);
    setLoadingArrangements(true);
    setError(null);
    try {
      const loaded = await api.getArrangements(song.id);
      setArrangements(loaded);
    } catch (err) {
      setArrangements([]);
      setError(toErrorMessage(err));
    } finally {
      setLoadingArrangements(false);
    }
  }

  async function selectArrangement(arrangement: Arrangement) {
    if (dirty && !window.confirm('Discard unsaved song changes?')) return;
    setSelectedArrangement(arrangement);
    await openArrangement(arrangement);
  }

  async function openArrangement(arrangement: Arrangement) {
    setLoadingEditor(true);
    setEditor(null);
    setError(null);
    try {
      const files = await api.getArrangementFiles(arrangement.id);
      const sngFiles = files.filter(isSngFile);
      const current = newestFile(sngFiles);
      if (!current) {
        throw new Error(`Arrangement “${arrangement.name}” has no .sng file.`);
      }
      const bytes = await api.downloadFile(current);
      const parsed = decodeSonBeamer(bytes);
      setEditor({
        file: current,
        document: parsed,
        lyricsText: parsed.lyricsText,
        verseOrder: [...parsed.verseOrder],
        originalLyricsText: parsed.lyricsText,
        originalVerseOrder: [...parsed.verseOrder],
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingEditor(false);
    }
  }

  async function save() {
    if (!editor || !selectedArrangement) return;
    setSaving(true);
    setError(null);

    try {
      const bytes = serializeSonBeamer(editor.document, editor.lyricsText, editor.verseOrder);
      const filesBefore = await api.getArrangementFiles(selectedArrangement.id);
      const oldSngFiles = filesBefore.filter(isSngFile);
      const filename = editor.file.name.toLowerCase().endsWith('.sng')
        ? editor.file.name
        : `${editor.document.title || 'song'}.sng`;

      const uploaded = await api.uploadArrangementFile(selectedArrangement.id, filename, bytes);
      const staleFiles = oldSngFiles.filter((file) => file.id !== uploaded.id);
      const deleteResults = await Promise.allSettled(staleFiles.map((file) => api.deleteFile(file.id)));
      const failedDeletes = deleteResults.filter((result) => result.status === 'rejected').length;

      const savedDocument = decodeSonBeamer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      setEditor({
        file: uploaded,
        document: savedDocument,
        lyricsText: editor.lyricsText,
        verseOrder: [...editor.verseOrder],
        originalLyricsText: editor.lyricsText,
        originalVerseOrder: [...editor.verseOrder],
      });

      if (failedDeletes > 0) {
        notify(`Saved. ${failedDeletes} previous .sng file(s) could not be removed.`);
      } else {
        notify('Saved to ChurchTools.');
      }
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function reloadEditor() {
    if (!selectedArrangement) return;
    if (dirty && !window.confirm('Discard unsaved song changes and reload from ChurchTools?')) return;
    void openArrangement(selectedArrangement);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CT</div>
          <div>
            <strong>Song Editor</strong>
            <span>ChurchTools · SonBeamer</span>
          </div>
        </div>
        <ConnectionPanel values={connection} onConnect={connect} busy={loadingSongs} />
      </header>

      {error ? (
        <div className="global-alert error-alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      ) : null}
      {message ? <div className="toast">{message}</div> : null}

      <div className="workspace">
        <SongBrowser
          songs={filteredSongs}
          selectedSongId={selectedSong?.id ?? null}
          arrangements={arrangements}
          selectedArrangementId={selectedArrangement?.id ?? null}
          query={filter}
          loadingSongs={loadingSongs}
          loadingArrangements={loadingArrangements}
          onQueryChange={setFilter}
          onSelectSong={selectSong}
          onSelectArrangement={selectArrangement}
        />

        {loadingEditor ? (
          <main className="editor-pane centered-state">
            <div className="loader" />
            <h2>Downloading SonBeamer file…</h2>
          </main>
        ) : null}

        {!loadingEditor && editor && selectedSong && selectedArrangement ? (
          <SongEditor
            song={selectedSong}
            arrangement={selectedArrangement}
            file={editor.file}
            document={editor.document}
            lyricsText={editor.lyricsText}
            verseOrder={editor.verseOrder}
            dirty={dirty}
            saving={saving}
            onLyricsChange={(lyricsText) => setEditor((current) => current ? { ...current, lyricsText } : current)}
            onVerseOrderChange={(verseOrder) => setEditor((current) => current ? { ...current, verseOrder } : current)}
            onSave={save}
            onReload={reloadEditor}
          />
        ) : null}

        {!loadingEditor && !editor ? (
          <main className="editor-pane welcome-state">
            <div className="welcome-card">
              <span className="eyebrow">ChurchTools song library</span>
              <h1>Select an arrangement to edit its SonBeamer file.</h1>
              <p>
                Connect with a ChurchTools login token. Requests are sent through this app&apos;s Cloudflare proxy to <code>nl.church.tools</code>; the editor preserves SonBeamer metadata, lets you split lyrics with <code>---</code>, edit verse order, and previews multilingual alternating lines.
              </p>
              <div className="flow-diagram" aria-label="Workflow">
                <span>Song</span><b>→</b><span>Arrangement</span><b>→</b><span>.sng editor</span><b>→</b><span>Replace file</span>
              </div>
            </div>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
