/**
 * Narrow the library down to the videos a plan may actually use, then compact
 * them for the prompt.
 *
 * The model never sees the library. It sees a shortlist that already satisfies
 * every hard constraint and picks from it, which keeps the request small, keeps
 * cost bounded on a large library, and means an id it returns is either real or
 * rejected — there is no third option where a plausible-looking invention slips
 * through.
 */
import db from '../db.js';
import { VIDEO_COLUMNS, formatVideoRow } from '../routes/library.js';
import { PROFILE_VIDEOS } from '../profiles.js';
import { getVideoProfiles, VideoProfile } from './videoProfiler.js';

/** How far over the session length a single video may run and still be offered. */
const LENGTH_SLACK_MINUTES = 10;

/** Equipment that never rules a video out. */
const ALWAYS_AVAILABLE = new Set(['mat', 'no_equipment']);

/** How many candidates to send at most, whatever the library size. */
const MAX_CANDIDATES = 200;

export interface CandidateFilter {
  /** Whose library to draw from. */
  profileId: string;
  /** Equipment the user owns. Empty means "don't filter on equipment". */
  equipment: string[];
  /** Album keys to draw from. Empty means the whole library. */
  includeAlbums: string[];
  /** Album keys to leave out, applied after `includeAlbums`. */
  excludeAlbums: string[];
  /**
   * Subfolders to leave out of an included album, as `Album/Sub` — or `Album/`
   * for the videos sitting directly in the album. Optional so older callers
   * that only know about whole albums keep working.
   */
  excludeFolders?: string[];
  /** Longest single video, in minutes. 0 or absent means no cap. */
  maxMinutes: number;
  /** Soft preferences — used for ranking here, and given to the model. */
  intensity: string;
  trainingTypes: string[];
  bodyParts: string[];
  /** The person's level: beginner, intermediate or advanced. Empty means any. Optional for older callers. */
  level?: string;
}

/** What the model is shown per video. Deliberately terse: this is per-token. */
export interface Candidate {
  id: string;
  title: string;
  minutes: number | null;
  equipment: string[];
  types: string[];
  parts: string[];
  intensity: string;
  album: string;
  /** Who the video suits — the user's own setting, else its profile's guess. */
  level: string;
  /** What the background profiler worked out, when it has run for this video. */
  profile?: VideoProfile;
}

export interface CandidateSet {
  candidates: Candidate[];
  /** How many passed the hard filters before the cap was applied. */
  matched: number;
  truncated: boolean;
}

/**
 * Which album a video belongs to.
 *
 * Mirrors `albumKeyForVideo` in client/src/lib/paths.ts. Duplicated on purpose:
 * six lines inside the AI module beats a shared import that would outlive the
 * module if the feature is ever removed.
 */
function albumKeyForVideo(video: {
  source: string;
  relative_path: string;
  external_playlist_id: string | null;
}): string {
  if ((video.source || 'local') !== 'local') {
    return `yt:${video.external_playlist_id || 'unknown'}`;
  }
  const parts = (video.relative_path || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '.';
}

/**
 * The subfolder a local video sits in, one level below its album: `Album/Sub`,
 * or `Album/` for a video directly in the album. Null for imports and for
 * videos at the library root, which have no folder to exclude.
 * Mirrors the key the client builds in AiPlanModal.
 */
function folderKeyForVideo(video: { source: string; relative_path: string }): string | null {
  if ((video.source || 'local') !== 'local') return null;
  const parts = (video.relative_path || '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : `${parts[0]}/`;
}

/** Display-only: the extension is noise in a prompt. */
function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

export function selectCandidates(filter: CandidateFilter): CandidateSet {
  const rows = db.prepare(`SELECT ${VIDEO_COLUMNS} FROM ${PROFILE_VIDEOS} AS videos`).all(filter.profileId) as any[];
  // Only what's in this person's library — not videos that are only there for a plan.
  const videos = rows.map(formatVideoRow).filter(video => video.in_library);

  const owned = new Set(filter.equipment);
  const include = new Set(filter.includeAlbums);
  const exclude = new Set(filter.excludeAlbums);
  const excludeFolders = new Set(filter.excludeFolders ?? []);
  // The session length is a target, not a limit on each video: a video a
  // little longer still fits a day on its own, and dropping it would empty
  // out folders of 26–30 minute workouts for a 25-minute plan.
  const maxSeconds = filter.maxMinutes > 0 ? (filter.maxMinutes + LENGTH_SLACK_MINUTES) * 60 : 0;

  const matched = videos.filter(video => {
    const album = albumKeyForVideo(video);
    if (include.size > 0 && !include.has(album)) return false;
    if (exclude.has(album)) return false;
    if (excludeFolders.size > 0) {
      const folder = folderKeyForVideo(video);
      if (folder && excludeFolders.has(folder)) return false;
    }

    // Only a hard filter when the user actually told us what they own —
    // otherwise an untagged library would filter down to nothing.
    // A mat (or nothing at all) is never a reason to leave a video out:
    // nearly everyone has a floor, and "No equipment" without "Mat" ticked
    // would otherwise quietly drop half the bodyweight and dance videos.
    if (owned.size > 0 && video.equipment.some(item => !ALWAYS_AVAILABLE.has(item) && !owned.has(item))) return false;

    // Unknown duration is kept rather than dropped: most imported videos have
    // one, but a video the scan never probed shouldn't silently disappear.
    if (maxSeconds > 0 && video.duration_seconds && video.duration_seconds > maxSeconds) return false;

    return true;
  });

  // Rank by how well each video matches the soft preferences, so the cap trims
  // the least relevant rather than an arbitrary tail. Ties keep library order.
  const profiles = getVideoProfiles(matched.map(video => video.id));
  const levelOf = (video: { id: string; level?: string }) => video.level || profiles.get(video.id)?.level || '';

  const ranked = matched
    .map((video, index) => ({ video, index, score: softScore(video, filter) + levelScore(levelOf(video), filter.level) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, MAX_CANDIDATES);

  return {
    candidates: ranked.map(({ video }) => ({
      id: video.id,
      title: stripExt(video.filename),
      minutes: video.duration_seconds ? Math.round(video.duration_seconds / 60) : null,
      equipment: video.equipment,
      types: video.training_type,
      parts: video.body_parts,
      intensity: video.intensity,
      album: albumKeyForVideo(video),
      level: levelOf(video),
      profile: profiles.get(video.id),
    })),
    matched: matched.length,
    truncated: matched.length > MAX_CANDIDATES,
  };
}

/**
 * How well a video's level suits the person. Matching or "all levels" is a
 * plus; a level far from theirs is a minus, but never a filter — a beginner
 * plan may still want the odd intermediate video as it builds up.
 */
function levelScore(videoLevel: string, personLevel?: string): number {
  if (!personLevel || !videoLevel) return 0;
  if (videoLevel === 'all' || videoLevel === personLevel) return 1.5;
  const order = ['beginner', 'intermediate', 'advanced'];
  const gap = Math.abs(order.indexOf(videoLevel) - order.indexOf(personLevel));
  return gap >= 2 ? -2 : 0;
}

function softScore(
  video: { training_type: string[]; body_parts: string[]; intensity: string },
  filter: CandidateFilter
): number {
  let score = 0;
  if (filter.intensity && video.intensity === filter.intensity) score += 2;
  for (const type of filter.trainingTypes) if (video.training_type.includes(type)) score += 1;
  for (const part of filter.bodyParts) if (video.body_parts.includes(part)) score += 1;
  // A tagged video is more useful to the model than an untagged one, all else
  // being equal — it can reason about it instead of guessing from the title.
  if (video.training_type.length || video.body_parts.length || video.intensity) score += 0.5;
  return score;
}
