import type { Arrangement, Song } from '../api/churchtools';

type Props = {
  songs: Song[];
  selectedSongId: number | null;
  arrangements: Arrangement[];
  selectedArrangementId: number | null;
  query: string;
  loadingSongs: boolean;
  loadingArrangements: boolean;
  onQueryChange: (query: string) => void;
  onSelectSong: (song: Song) => void;
  onSelectArrangement: (arrangement: Arrangement) => void;
};

export default function SongBrowser({
  songs,
  selectedSongId,
  arrangements,
  selectedArrangementId,
  query,
  loadingSongs,
  loadingArrangements,
  onQueryChange,
  onSelectSong,
  onSelectArrangement,
}: Props) {
  return (
    <aside className="browser-pane">
      <section className="browser-section song-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Bibliothek</span>
            <h2>Lieder</h2>
          </div>
          <span className="count-badge">{songs.length}</span>
        </div>
        <input
          className="search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Geladene Lieder filtern …"
          aria-label="Lieder filtern"
        />
        <div className="list song-list">
          {loadingSongs ? <div className="empty-state">Lieder werden geladen …</div> : null}
          {!loadingSongs && songs.length === 0 ? (
            <div className="empty-state">Keine Lieder geladen.</div>
          ) : null}
          {songs.map((song) => (
            <button
              key={song.id}
              type="button"
              className={`list-row ${selectedSongId === song.id ? 'selected' : ''}`}
              onClick={() => onSelectSong(song)}
            >
              <span className="row-title">{song.name}</span>
              <span className="row-meta">
                {song.category?.nameTranslated || song.category?.name || 'Ohne Kategorie'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="browser-section arrangement-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Ausgewähltes Lied</span>
            <h2>Arrangements</h2>
          </div>
          <span className="count-badge">{arrangements.length}</span>
        </div>
        <div className="list arrangement-list">
          {loadingArrangements ? <div className="empty-state">Arrangements werden geladen …</div> : null}
          {!loadingArrangements && selectedSongId === null ? (
            <div className="empty-state">Wähle ein Lied, um seine Arrangements zu sehen.</div>
          ) : null}
          {!loadingArrangements && selectedSongId !== null && arrangements.length === 0 ? (
            <div className="empty-state">Dieses Lied hat keine Arrangements.</div>
          ) : null}
          {arrangements.map((arrangement) => (
            <button
              key={arrangement.id}
              type="button"
              className={`list-row ${selectedArrangementId === arrangement.id ? 'selected' : ''}`}
              onClick={() => onSelectArrangement(arrangement)}
            >
              <span className="row-title arrangement-title">
                {arrangement.name}
                {arrangement.isDefault ? <span className="tag">Standard</span> : null}
              </span>
              <span className="row-meta">
                {[arrangement.key, arrangement.tempo ? `${arrangement.tempo} BPM` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Keine Tonart / kein Tempo'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
