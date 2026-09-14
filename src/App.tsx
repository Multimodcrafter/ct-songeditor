import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChurchToolsApi,
  isSngFile,
  newestFile,
  type Arrangement,
  type ChurchToolsFile,
  type Song,
} from './api/churchtools';
import ConnectionPanel from './components/ConnectionPanel';
import { consumeAuthError, getSession, login, logout, type AuthSession } from './api/auth';
import SongBrowser from './components/SongBrowser';
import SongEditor from './components/SongEditor';
import { decodeSongBeamer, serializeSongBeamer, type ParsedSongBeamer } from './lib/songbeamer';

type EditorState = {
  file: ChurchToolsFile;
  document: ParsedSongBeamer;
  lyricsText: string;
  verseOrder: string[];
  originalLyricsText: string;
  originalVerseOrder: string[];
};

const initialAuthError = consumeAuthError();
// Remove credentials left by the former manual-token login.
sessionStorage.removeItem('churchtools-login-token');

export default function App() {
  const [auth, setAuth] = useState<AuthSession>({ authenticated: false, configured: false });
  const [authBusy, setAuthBusy] = useState(true);
  const [api] = useState(() => new ChurchToolsApi(() => setAuth((current) => ({ ...current, authenticated: false }))));
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
  const [error, setError] = useState<string | null>(initialAuthError);
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
    let active = true;
    void getSession().then(async (current) => {
      if (!active) return;
      setAuth(current);
      if (current.authenticated) await loadSongs();
    }).catch((err) => {
      if (active) setError(toErrorMessage(err));
    }).finally(() => {
      if (active) setAuthBusy(false);
    });
    return () => {
      active = false;
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    };
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

  async function signIn() {
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen verwerfen und zur Anmeldung wechseln?')) return;
    setAuthBusy(true);
    try { await login(); } catch (err) { setError(toErrorMessage(err)); setAuthBusy(false); }
  }

  async function signOut() {
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen verwerfen und abmelden?')) return;
    setAuthBusy(true);
    try {
      await logout();
      setAuth((current) => ({ ...current, authenticated: false }));
      setSongs([]);
      setSelectedSong(null);
      setSelectedArrangement(null);
      setArrangements([]);
      setEditor(null);
      setError(null);
      setMessage(null);
    } catch (err) { setError(toErrorMessage(err)); }
    finally { setAuthBusy(false); }
  }

  async function selectSong(song: Song) {
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
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
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
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
        throw new Error(`Das Arrangement „${arrangement.name}“ enthält keine .sng-Datei.`);
      }
      const bytes = await api.downloadFile(current);
      const parsed = decodeSongBeamer(bytes);
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
    if (!editor || !selectedArrangement || !auth.authenticated) return;
    setSaving(true);
    setError(null);

    try {
      const bytes = serializeSongBeamer(editor.document, editor.lyricsText, editor.verseOrder);
      const filesBefore = await api.getArrangementFiles(selectedArrangement.id);
      const oldSngFiles = filesBefore.filter(isSngFile);
      const filename = editor.file.name.toLowerCase().endsWith('.sng')
        ? editor.file.name
        : `${editor.document.title || 'Lied'}.sng`;

      const uploaded = await api.uploadArrangementFile(selectedArrangement.id, filename, bytes);
      const staleFiles = oldSngFiles.filter((file) => file.id !== uploaded.id);
      const deleteResults = await Promise.allSettled(staleFiles.map((file) => api.deleteFile(file.id)));
      const failedDeletes = deleteResults.filter((result) => result.status === 'rejected').length;

      const savedDocument = decodeSongBeamer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      setEditor({
        file: uploaded,
        document: savedDocument,
        lyricsText: editor.lyricsText,
        verseOrder: [...editor.verseOrder],
        originalLyricsText: editor.lyricsText,
        originalVerseOrder: [...editor.verseOrder],
      });

      if (failedDeletes > 0) {
        notify(`Gespeichert. ${failedDeletes} vorherige .sng-Datei(en) konnten nicht entfernt werden.`);
      } else {
        notify('In ChurchTools gespeichert.');
      }
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function reloadEditor() {
    if (!selectedArrangement) return;
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen verwerfen und die Datei aus ChurchTools neu laden?')) return;
    void openArrangement(selectedArrangement);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">CT</div>
          <div>
            <strong>Liededitor</strong>
            <span>ChurchTools · SongBeamer</span>
          </div>
        </div>
        <ConnectionPanel authenticated={auth.authenticated} configured={auth.configured} onLogin={signIn} onLogout={signOut} busy={authBusy || loadingSongs || loadingArrangements || loadingEditor || saving} />
      </header>

      {error ? (
        <div className="global-alert error-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Schließen</button>
        </div>
      ) : null}
      {message ? <div className="toast" role="status">{message}</div> : null}

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
            <h2>SongBeamer-Datei wird geladen …</h2>
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
            authenticated={auth.authenticated}
            onLyricsChange={(lyricsText) => setEditor((current) => current ? { ...current, lyricsText } : current)}
            onVerseOrderChange={(verseOrder) => setEditor((current) => current ? { ...current, verseOrder } : current)}
            onSave={save}
            onReload={reloadEditor}
          />
        ) : null}

        {!loadingEditor && !editor ? (
          <main className="editor-pane welcome-state">
            <div className="welcome-card">
              <span className="eyebrow">ChurchTools-Liedbibliothek</span>
              <h1>{auth.authenticated ? 'Wähle ein Arrangement und bearbeite seine SongBeamer-Datei.' : 'Melde dich mit ChurchTools an, um deine Lieder zu bearbeiten.'}</h1>
              <p>
                Bearbeite Liedtexte, teile sie mit <code>---</code> in Folien auf und lege die Versreihenfolge fest.
                Die Vorschau zeigt auch mehrsprachige Lieder. Beim Speichern bleiben die SongBeamer-Metadaten erhalten.
              </p>
              <div className="flow-diagram" aria-label="Arbeitsablauf">
                <span>Lied</span><b>→</b><span>Arrangement</span><b>→</b><span>Bearbeiten</span><b>→</b><span>Speichern</span>
              </div>
            </div>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'Die Verbindung ist fehlgeschlagen. Bitte prüfe deine Internetverbindung und versuche es erneut.';
  return error instanceof Error ? error.message : String(error);
}
