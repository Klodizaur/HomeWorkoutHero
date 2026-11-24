import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LibraryToolbar, { LibrarySort, LibraryView, ActiveChip } from '../components/library/LibraryToolbar';
import FiltersSheet from '../components/library/FiltersSheet';
import {
  AddFromYouTubeCard, AddFromYouTubeRow, FolderCard, FolderItem, FolderRow, VideoGridCard, VideoListRow,
} from '../components/library/LibraryCards';
import { EMPTY_LENGTH, isLengthActive, LengthRange, matchesLength, matchesLevel, matchesQuery, matchesSource, matchesTags, useFilterMatchMode, SourceFilter } from '../lib/filters';
import { useLengthLabel } from '../components/library/LengthFilter';
import { useMetaLabels } from '../lib/labels';
import { albumKeyForVideo, FAVORITES_ALBUM_KEY, isExternalAlbumKey, isExternalVideo, toAlbumRouteParam } from '../lib/paths';
import { toggleVideoFavorite } from '../lib/favorites';
import { ImportResult, useDescriptionProgress, useImportAvailable } from '../lib/externalImport';
import { useIsMobile } from '../lib/useIsMobile';
import VideoDetailsModal from '../components/VideoDetailsModal';
import YouTubeImportModal from '../components/YouTubeImportModal';
import { inLibrary, Video } from '../types/video';
import '../styles/library.css';
import { compareAdded, compareAmount, naturalCompare, sortVideos } from '../lib/videoSort';
import { timeAgo } from '../lib/dates';
import { useRootFolderName } from '../lib/rootFolder';
import { LIBRARY_SCANNED_EVENT, startRescan, useScanStatus } from '../lib/scanStatus';
import { notify } from '../lib/notify';
import { isTv } from '../lib/tv';
import { SETTINGS_SAVED_EVENT } from '../lib/settingsEvents';
import { FolderPlus, RefreshCw } from 'lucide-react';
import { setPinned, usePinnedFolders } from '../lib/pins';

const PAGE = 24;
const RECENT_COUNT = 6;

/**
 * Library index: the folders and imported albums, with search and filters.
 *
 * Folders are the point of this screen, so videos only appear once a search or
 * a filter is on — then it shows matching folders above matching videos, since
 * a search for "arms" could mean either.
 */
export default function Library() {
  const { t, i18n } = useTranslation();
  const rootName = useRootFolderName();
  const labels = useMetaLabels();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [videos, setVideos] = useState<Video[]>([]);
  const [detailsVideo, setDetailsVideo] = useState<Video | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('az');
  const [view, setView] = useState<LibraryView | null>(null);
  const [source, setSource] = useState<SourceFilter>('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingType, setTrainingType] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string[]>([]);
  const [level, setLevel] = useState<string[]>([]);
  const [length, setLength] = useState<LengthRange>(EMPTY_LENGTH);
  const lengthLabel = useLengthLabel();
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // Every video listed under the folders, the way an album's "Include
  // subfolders" does — without having to search for something first.
  const [showAll, setShowAll] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);

  // List is the sensible default on a phone and grid on a desktop, until the
  // user picks one.
  const effectiveView: LibraryView = view || (isMobile ? 'list' : 'grid');

  const [loaded, setLoaded] = useState(false);
  const loadVideos = useCallback(() => {
    fetch('/api/library/videos')
      .then(r => r.json())
      // Only your library — not videos that are only here for one of your plans.
      .then((data: Video[]) => { setVideos((data || []).filter(inLibrary)); setLoaded(true); })
      .catch(err => console.error('Failed to load library:', err));
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  // The folder videos are scanned from: '' when none is set yet, null while
  // loading. Decides between "add your folder" and the Rescan button.
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/settings')
      .then(r => (r.ok ? r.json() : {}))
      .then((data: { video_directory?: string }) => setFolder(data.video_directory || ''))
      .catch(() => setFolder(''));
    load();
    window.addEventListener(SETTINGS_SAVED_EVENT, load);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, load);
  }, []);

  // New videos show up as soon as a scan finishes, wherever it was started.
  useEffect(() => {
    window.addEventListener(LIBRARY_SCANNED_EVENT, loadVideos);
    return () => window.removeEventListener(LIBRARY_SCANNED_EVENT, loadVideos);
  }, [loadVideos]);

  const scan = useScanStatus();
  const scanning = !!scan?.active;
  const rescan = async () => {
    const problem = await startRescan();
    if (problem === 'busy') notify(t('library.rescan_busy'), 'ok');
    else if (problem === 'missing_directory') notify(t('library.rescan_missing', { folder }));
    else if (problem === 'no_directory') setFolder('');
    else if (problem) notify(t('library.rescan_failed'));
  };
  const openFolderSettings = () => navigate('/settings?tab=workouts&focus=folder');
  const noFolder = folder === '';
  const emptyFolder = !!folder && loaded && videos.every(v => isExternalVideo(v));

  const importAvailable = useImportAvailable();
  // Descriptions are fetched in the background after an import, so refresh
  // while that runs rather than leaving the user to reload the page.
  useDescriptionProgress(justImported, loadVideos);

  const filterCount = equipment.length + trainingType.length + bodyParts.length + intensity.length + level.length + (isLengthActive(length) ? 1 : 0);
  const trimmedQuery = query.trim();
  const isFiltering = filterCount > 0 || trimmedQuery.length > 0;

  /** Videos left by the source switch and the filter groups (not the search). */
  const filteredVideos = useMemo(() => videos.filter(video => {
    if (!matchesSource(video, source)) return false;
    if (!matchesTags(video.equipment, equipment, matchMode)) return false;
    if (!matchesTags(video.training_type, trainingType, 'any')) return false;
    if (!matchesTags(video.body_parts, bodyParts, 'any')) return false;
    if (intensity.length > 0 && !intensity.includes(video.intensity || '')) return false;
    if (!matchesLevel(video.level, level)) return false;
    if (!matchesLength(video.duration_seconds, length)) return false;
    return true;
  }), [videos, source, equipment, trainingType, bodyParts, intensity, level, length, matchMode]);

  const albums = useMemo<FolderItem[]>(() => {
    const map = new Map<string, Video[]>();
    for (const video of filteredVideos) {
      const key = albumKeyForVideo(video);
      const arr = map.get(key) || [];
      arr.push(video);
      map.set(key, arr);
    }

    const addedRange = new Map<string, { newest?: string; oldest?: string }>();
    // A folder's length is all its videos together; its "times done" likewise.
    const totals = new Map<string, { seconds: number; done: number }>();
    for (const [key, vids] of map) {
      totals.set(key, {
        seconds: vids.reduce((sum, v) => sum + (v.duration_seconds || 0), 0),
        done: vids.reduce((sum, v) => sum + (v.completed_count || 0), 0),
      });
      const dates = vids.map(v => v.added_at).filter((d): d is string => Boolean(d)).sort();
      addedRange.set(key, { oldest: dates[0], newest: dates[dates.length - 1] });
    }

    const result: FolderItem[] = Array.from(map.entries()).map(([key, vids]) => {
      const stored = localStorage.getItem(`albumImage:${key}`);
      return {
        key,
        title: isExternalAlbumKey(key)
          ? (vids[0]?.external_playlist_title || t('library.untitled_playlist'))
          : key === '.' ? rootName : key,
        cover: stored || (vids[0]?.thumbnail_path ? `/thumbnails/${vids[0].thumbnail_path}` : null),
        count: vids.length,
        isExternal: isExternalAlbumKey(key),
      };
    });

    if (sort === 'size') result.sort((a, b) => b.count - a.count);
    else if (sort === 'small') result.sort((a, b) => a.count - b.count);
    else if (sort === 'long' || sort === 'short') {
      result.sort((a, b) => compareAmount(totals.get(a.key)?.seconds, totals.get(b.key)?.seconds, sort === 'long') || naturalCompare(a.title, b.title));
    } else if (sort === 'done') result.sort((a, b) => (totals.get(b.key)?.done || 0) - (totals.get(a.key)?.done || 0) || naturalCompare(a.title, b.title));
    else if (sort === 'undone') result.sort((a, b) => (totals.get(a.key)?.done || 0) - (totals.get(b.key)?.done || 0) || naturalCompare(a.title, b.title));
    // A folder is as new as its newest video, and as old as its oldest one.
    else if (sort === 'newest') result.sort((a, b) => compareAdded(addedRange.get(a.key)?.newest, addedRange.get(b.key)?.newest, true));
    else if (sort === 'oldest') result.sort((a, b) => compareAdded(addedRange.get(a.key)?.oldest, addedRange.get(b.key)?.oldest, false));
    else result.sort((a, b) => naturalCompare(a.title, b.title));
    if (sort === 'za') result.reverse();
    // Imported playlists group together after the user's own folders.
    result.sort((a, b) => Number(a.isExternal) - Number(b.isExternal));

    // Favourites is pinned first whatever the sort: it's a shortcut, not a folder.
    const starred = filteredVideos.filter(v => v.is_favorite);
    if (starred.length > 0) {
      result.unshift({
        key: FAVORITES_ALBUM_KEY,
        title: t('library.favorites'),
        cover: starred[0].thumbnail_path ? `/thumbnails/${starred[0].thumbnail_path}` : null,
        count: starred.length,
        isExternal: false,
        isFavorites: true,
      });
    }
    return result;
  }, [filteredVideos, sort, t, rootName]);

  /** How many albums the library has in total — the header describes the
      library, so it shouldn't shrink as filters are applied. */
  const totalAlbums = useMemo(
    () => new Set(videos.map(albumKeyForVideo)).size,
    [videos]
  );

  const visibleFolders = useMemo(
    () => (trimmedQuery ? albums.filter(a => matchesQuery([a.title], trimmedQuery)) : albums),
    [albums, trimmedQuery]
  );

  // Pinned folders lead the Folders section, newest pin first, a little bigger
  // in grid view; the rest follow as usual. Favourites leads the rest.
  const pinnedKeys = usePinnedFolders();
  const pinnedFolders = useMemo(
    () => pinnedKeys
      .map(key => visibleFolders.find(f => f.key === key))
      .filter((f): f is FolderItem => !!f && !f.isFavorites),
    [pinnedKeys, visibleFolders]
  );
  const otherFolders = useMemo(
    () => visibleFolders.filter(f => !pinnedFolders.includes(f)),
    [visibleFolders, pinnedFolders]
  );
  const pinProps = (folder: FolderItem) => folder.isFavorites ? {} : {
    pinned: pinnedKeys.includes(folder.key),
    onPin: () => setPinned(folder.key, !pinnedKeys.includes(folder.key)),
  };

  /** Videos are listed once something is searched or filtered for, or on request. */
  const listVideos = isFiltering || showAll;
  const matchingVideos = useMemo(() => {
    if (!listVideos) return [];
    const found = filteredVideos.filter(v =>
      matchesQuery([v.filename, v.description], trimmedQuery));
    return sortVideos(found, sort);
  }, [filteredVideos, listVideos, trimmedQuery, sort]);

  /** Where a video lives: its playlist for an import, else its folder path (none for loose files). */
  const folderLabel = (video: Video): string | undefined => {
    if (isExternalVideo(video)) return video.external_playlist_title || t('library.untitled_playlist');
    const dirs = (video.relative_path || '').split('/').slice(0, -1);
    return dirs.length ? dirs.join(' / ') : undefined;
  };

  /** The newest few, above the folders. Follows the source switch. */
  const recentVideos = useMemo(
    () => sortVideos(filteredVideos.filter(v => v.added_at), 'newest').slice(0, RECENT_COUNT),
    [filteredVideos]
  );

  const shown = matchingVideos.slice(0, limit);
  const left = matchingVideos.length - shown.length;

  const activeChips: ActiveChip[] = [
    ...equipment.map(v => ({
      key: `eq:${v}`, label: labels.equipment(v), category: 'gear' as const,
      remove: () => setEquipment(prev => prev.filter(x => x !== v)),
    })),
    ...trainingType.map(v => ({
      key: `type:${v}`, label: labels.trainingType(v), category: 'type' as const,
      remove: () => setTrainingType(prev => prev.filter(x => x !== v)),
    })),
    ...bodyParts.map(v => ({
      key: `body:${v}`, label: labels.bodyPart(v), category: 'body' as const,
      remove: () => setBodyParts(prev => prev.filter(x => x !== v)),
    })),
    ...intensity.map(v => ({
      key: `int:${v}`, label: labels.intensity(v), category: 'intensity' as const,
      remove: () => setIntensity(prev => prev.filter(x => x !== v)),
    })),
    ...level.map(v => ({
      key: `lvl:${v}`, label: labels.level(v), category: 'intensity' as const,
      remove: () => setLevel(prev => prev.filter(x => x !== v)),
    })),
    ...(isLengthActive(length) ? [{
      key: 'length', label: lengthLabel(length), category: 'length' as const,
      remove: () => setLength(EMPTY_LENGTH),
    }] : []),
  ];

  const clearAll = () => {
    setEquipment([]); setTrainingType([]); setBodyParts([]); setIntensity([]); setLevel([]); setLength(EMPTY_LENGTH); setQuery('');
  };

  const openAlbum = (key: string) =>
    navigate(`/library/${encodeURIComponent(toAlbumRouteParam(key))}`);

  const handleImported = (result: ImportResult) => {
    // Merge rather than refetch so the new album appears immediately.
    setVideos(prev => {
      const byId = new Map(prev.map(v => [v.id, v]));
      for (const v of result.videos || []) byId.set(v.id, v);
      return Array.from(byId.values());
    });
    setIsImportOpen(false);
    setJustImported(true);
  };

  // Hidden while searching or filtering, and when the source switch is set to
  // local files — in those states it isn't one of the results.
  const showAddYouTube = importAvailable && !isFiltering && source !== 'local';
  const addYouTube = <AddFromYouTubeCard onOpen={() => setIsImportOpen(true)} />;

  return (
    <div className="lib">
      <header className="rx-wrap lib-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{t('nav.library')}</h1>
          <div className="lib-head-meta">
            {t('library.folders_and_videos', { folders: totalAlbums, videos: videos.length })}
          </div>
          {folder && !isTv && <div className="lib-head-folder" title={folder}>{t('library.from_folder', { folder })}</div>}
        </div>
        {folder && !isTv && (
          <button
            type="button"
            className="rx-btn lib-rescan"
            onClick={rescan}
            disabled={scanning}
            title={t('library.rescan_hint')}
          >
            <RefreshCw size={16} className={scanning ? 'lib-spin' : undefined} />
            <span>{scanning ? t('library.scanning') : t('library.rescan')}</span>
          </button>
        )}
      </header>

      <LibraryToolbar
        query={query}
        onQuery={value => { setQuery(value); setLimit(PAGE); }}
        placeholder={t('library.search_folders_videos')}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        source={source}
        onSource={value => { setSource(value); setLimit(PAGE); }}
        sort={sort}
        onSort={setSort}
        sizeLabel={t('library.sort_most_videos')}
        smallLabel={t('library.sort_fewest_videos')}
        view={effectiveView}
        onView={setView}
        activeChips={activeChips}
        onClearAll={clearAll}
      />

      <div className="rx-wrap lib-body">
        {/* How videos get here: the most asked question, answered where
            people look for them. */}
        {noFolder && (
          <section className="lib-setup">
            <span className="lib-setup-icon"><FolderPlus size={22} /></span>
            <div className="lib-setup-text">
              <strong>{t('library.setup_title')}</strong>
              <p>{isTv ? t('library.setup_tv') : t('library.setup_text')}</p>
            </div>
            {!isTv && (
              <button type="button" className="rx-btn rx-btn--primary" onClick={openFolderSettings}>
                {t('library.setup_cta')}
              </button>
            )}
          </section>
        )}
        {emptyFolder && !isTv && (
          <section className="lib-setup">
            <span className="lib-setup-icon"><FolderPlus size={22} /></span>
            <div className="lib-setup-text">
              <strong>{t('library.empty_folder_title')}</strong>
              <p>{t('library.empty_folder_text', { folder })}</p>
            </div>
            <div className="lib-setup-btns">
              <button type="button" className="rx-btn" onClick={openFolderSettings}>{t('library.change_folder')}</button>
              <button type="button" className="rx-btn rx-btn--primary" onClick={rescan} disabled={scanning}>
                {scanning ? t('library.scanning') : t('library.rescan')}
              </button>
            </div>
          </section>
        )}
        {!isFiltering && recentVideos.length > 0 && (
          <section>
            <div className="lib-section-head">
              <h2>{t('dashboard.recently_added')}</h2>
            </div>
            <div className="lib-recent">
              {recentVideos.map(video => (
                <VideoGridCard
                  key={video.id}
                  video={video}
                  meta={folderLabel(video)}
                  note={timeAgo(video.added_at!, i18n.language)}
                  onOpen={() => setDetailsVideo(video)}
                  onPlay={() => navigate(`/player/${video.id}`)}
                  onInfo={() => setDetailsVideo(video)}
                  onFavorite={() => toggleVideoFavorite(video, setVideos)}
                />
              ))}
            </div>
          </section>
        )}

        {(visibleFolders.length > 0 || showAddYouTube) && (
          <section>
            <div className="lib-section-head">
              <h2>{t('library.folders')}</h2>
              <span className="lib-section-count">{visibleFolders.length}</span>
              {!isFiltering && (
                <button
                  type="button"
                  className="lib-scope"
                  aria-pressed={showAll}
                  onClick={() => { setShowAll(v => !v); setLimit(PAGE); }}
                >
                  <span className={`lib-scope-track${showAll ? ' is-on' : ''}`}>
                    <span className="lib-scope-knob" />
                  </span>
                  {t('library.show_all_videos')}
                </button>
              )}
            </div>

            {effectiveView === 'grid' ? (
              <>
              {pinnedFolders.length > 0 && (
                <div className="lib-grid lib-grid--pinned">
                  {pinnedFolders.map(folder => (
                    <FolderCard key={folder.key} folder={folder} onOpen={() => openAlbum(folder.key)} {...pinProps(folder)} />
                  ))}
                </div>
              )}
              <div className="lib-grid">
                {/* First on a phone so it's reachable without scrolling the
                    whole library; last on desktop so it doesn't displace one. */}
                {showAddYouTube && isMobile && addYouTube}
                {otherFolders.map(folder => (
                  <FolderCard key={folder.key} folder={folder} onOpen={() => openAlbum(folder.key)} {...pinProps(folder)} />
                ))}
                {showAddYouTube && !isMobile && addYouTube}
              </div>
              </>
            ) : (
              <div className="lib-rows">
                {showAddYouTube && <AddFromYouTubeRow onOpen={() => setIsImportOpen(true)} />}
                {[...pinnedFolders, ...otherFolders].map(folder => (
                  <FolderRow key={folder.key} folder={folder} onOpen={() => openAlbum(folder.key)} {...pinProps(folder)} />
                ))}
              </div>
            )}
          </section>
        )}

        {listVideos && (
          <section>
            <div className="lib-section-head">
              <h2>{isFiltering ? t('library.matching_videos') : t('library.all_videos')}</h2>
              <span className="lib-section-count">{matchingVideos.length}</span>
            </div>

            {matchingVideos.length === 0 ? (
              <div className="lib-empty">
                <div className="lib-empty-title">{t('library.no_videos_match')}</div>
                <div className="lib-empty-hint">{t('library.no_videos_match_hint')}</div>
              </div>
            ) : effectiveView === 'grid' ? (
              <div className="lib-grid">
                {shown.map(video => (
                  <VideoGridCard
                    key={video.id}
                    video={video}
                    meta={folderLabel(video)}
                    note={video.added_at ? timeAgo(video.added_at, i18n.language) : undefined}
                    onOpen={() => setDetailsVideo(video)}
                    onPlay={() => navigate(`/player/${video.id}`)}
                    onInfo={() => setDetailsVideo(video)}
                    onFavorite={() => toggleVideoFavorite(video, setVideos)}
                  />
                ))}
              </div>
            ) : (
              <div className="lib-video-rows">
                {shown.map(video => (
                  <VideoListRow
                    key={video.id}
                    video={video}
                    meta={folderLabel(video)}
                    note={video.added_at ? timeAgo(video.added_at, i18n.language) : undefined}
                    onOpen={() => setDetailsVideo(video)}
                    onPlay={() => navigate(`/player/${video.id}`)}
                    onInfo={() => setDetailsVideo(video)}
                    onFavorite={() => toggleVideoFavorite(video, setVideos)}
                  />
                ))}
              </div>
            )}

            {left > 0 && (
              <button type="button" className="lib-more" onClick={() => setLimit(l => l + PAGE)}>
                {t('library.show_more', { count: Math.min(PAGE, left), left })}
              </button>
            )}
          </section>
        )}
      </div>

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        equipment={equipment}
        onEquipment={setEquipment}
        trainingType={trainingType}
        onTrainingType={setTrainingType}
        bodyParts={bodyParts}
        onBodyParts={setBodyParts}
        intensity={intensity}
        onIntensity={setIntensity}
        level={level}
        onLevel={setLevel}
        length={length}
        onLength={setLength}
        matchMode={matchMode}
        onMatchMode={setMatchMode}
        onClearAll={clearAll}
        resultCount={filteredVideos.length}
      />

      {detailsVideo && (
        <VideoDetailsModal
          video={detailsVideo}
          onClose={() => setDetailsVideo(null)}
          onSaved={updated => setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)))}
        />
      )}

      {isImportOpen && (
        <YouTubeImportModal onClose={() => setIsImportOpen(false)} onImported={handleImported} />
      )}
    </div>
  );
}
