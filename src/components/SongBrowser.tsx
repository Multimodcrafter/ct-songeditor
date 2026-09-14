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
            <span className="eyebrow">Library</span>
            <h2>Songs</h2>
          </div>
          <span className="count-badge">{songs.length}</span>
        </div>
        <input
          className="search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter loaded songs…"
          aria-label="Filter songs"
        />
        <div className="list song-list">
          {loadingSongs ? <div className="empty-state">Loading songs…</div> : null}
          {!loadingSongs && songs.length === 0 ? (
            <div className="empty-state">No songs loaded.</div>
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
                {song.category?.nameTranslated || song.category?.name || 'Uncategorized'}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="browser-section arrangement-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">Selected song</span>
            <h2>Arrangements</h2>
          </div>
          <span className="count-badge">{arrangements.length}</span>
        </div>
        <div className="list arrangement-list">
          {loadingArrangements ? <div className="empty-state">Loading arrangements…</div> : null}
          {!loadingArrangements && selectedSongId === null ? (
            <div className="empty-state">Select a song to see arrangements.</div>
          ) : null}
          {!loadingArrangements && selectedSongId !== null && arrangements.length === 0 ? (
            <div className="empty-state">This song has no arrangements.</div>
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
                {arrangement.isDefault ? <span className="tag">Default</span> : null}
              </span>
              <span className="row-meta">
                {[arrangement.key, arrangement.tempo ? `${arrangement.tempo} BPM` : null]
                  .filter(Boolean)
                  .join(' · ') || 'No key / tempo'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
