/**
 * Video profiles: what the plan builder knows about a video beyond its tags.
 *
 * Tags say what a video *is* (Strength, arms, medium). A profile adds what a
 * coach would want to know when arranging it — how hard it is on the joints,
 * who it suits, how much of its length is actual work, whether it carries its
 * own warm-up — inferred once from the title, folder, description and the
 * user's tags, then stored so the builder never has to guess again.
 *
 * Runs entirely in the background. Nothing here is shown in the interface
 * beyond a progress count in the AI settings, and the user's own tags are
 * inputs only: a profile adds to them and never overwrites them.
 *
 * Profiles are shared. Tags live on the shared `videos` row, so a profile is
 * keyed by video id and every app profile benefits from it. Whose API key pays
 * is per app profile, though: each profile that switched this on only ever
 * spends its own key on videos in its own library.
 */
import crypto from 'crypto';
import db from '../db.js';
import { callModel, AiError } from './provider.js';
import { AiSettings, aiProfile, getAiSettings, isAiConfigured } from './settings.js';

/**
 * Profiling is a simple, repetitive task, so it runs on the provider's cheap
 * model rather than whatever large model the user picked for building plans.
 * Only for the official hosts, where these names are known to exist; anything
 * else (OpenRouter, Ollama, a proxy) uses the configured model as is.
 */
const CHEAP_MODELS: Record<string, string> = {
  'api.openai.com': 'gpt-4o-mini',
  'api.anthropic.com': 'claude-haiku-5-5',
};

function profilingModel(settings: AiSettings): string {
  try {
    return CHEAP_MODELS[new URL(settings.baseUrl).hostname.toLowerCase()] || settings.model;
  } catch {
    return settings.model;
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS video_profiles (
    video_id TEXT PRIMARY KEY,
    -- Hash of everything the profile was generated from. When the video's
    -- title, tags or description change, this stops matching and the profile
    -- is regenerated in the background.
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,            -- 'done' | 'failed'
    impact TEXT,                     -- 'low' | 'medium' | 'high'
    level TEXT,                      -- 'beginner' | 'intermediate' | 'advanced' | 'all'
    work_minutes INTEGER,            -- length minus intro, warm-up, cool-down, outro
    has_warmup INTEGER,
    has_cooldown INTEGER,
    good_for TEXT,                   -- JSON array of short phrases
    notes TEXT,
    confidence TEXT,                 -- 'low' | 'medium' | 'high'
    attempts INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
// Tags this profiler has ever added to the video. Kept so a tag the user
// removed afterwards is never added back.
if (!(db.pragma("table_info('video_profiles')") as any[]).some((c: any) => c.name === 'suggested')) {
  db.exec("ALTER TABLE video_profiles ADD COLUMN suggested TEXT NOT NULL DEFAULT '[]'");
}

/**
 * Tags that arrived after most libraries were already tagged. Nobody could
 * have picked them before, so the profiler may add them where they clearly
 * apply — the only tags it ever writes. Everything else stays the user's.
 */
const SUGGESTABLE_TYPES = ['Tabata', 'Circuit', 'Calisthenics', 'Treadmill', 'Indoor Cycling', 'Finisher', 'Seniors', 'Dance', 'Aerobics', 'Boxing', 'Walking', 'Barre', 'Body & Mind', 'Kids', 'Quiet', 'Seated', 'Prenatal', 'Postnatal'];
const SUGGESTABLE_BODY_PARTS = ['hips', 'pelvic_floor', 'neck'];

/** Setting key (under the ai_ prefix) that switches the worker on for a profile. */
export const VIDEO_PROFILES_SETTING = 'video_profiles';

/** Videos per request. Same reasoning as the description clean-up. */
const BATCH_SIZE = 8;
/** Pause between batches, so a 400-video backfill never crowds out the app. */
const BATCH_PAUSE_MS = 3_000;
/** How long to sleep when there's nothing to do, unless nudged sooner. */
const IDLE_MS = 10 * 60_000;
/** Back-off after an error that will recur (bad key, endpoint down). */
const ERROR_BACKOFF_MS = 30 * 60_000;
/** Give up on a video after this many unusable replies, until its inputs change. */
const MAX_ATTEMPTS = 3;
/** Delay after server start, so the backfill doesn't compete with startup. */
const START_DELAY_MS = 15_000;

const MAX_DESCRIPTION_CHARS = 1500;

const IMPACTS = ['low', 'medium', 'high'] as const;
const LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;
const CONFIDENCES = ['low', 'medium', 'high'] as const;

/** Errors that will fail every batch, so the profile's run should stop. */
const STOP_CODES = new Set(['auth', 'not_configured', 'unreachable', 'not_found', 'rate_limit']);

// ---------------------------------------------------------------------------
// Inputs and fingerprints
// ---------------------------------------------------------------------------

interface VideoInput {
  id: string;
  filename: string;
  relative_path: string;
  source: string;
  external_playlist_title: string | null;
  description: string | null;
  equipment: string | null;
  training_type: string | null;
  body_parts: string | null;
  intensity: string | null;
  duration_seconds: number | null;
}

// The shared path, not the per-profile one: two profiles with different
// library folders must produce the same fingerprint, or they'd keep
// invalidating each other's profile of the same video.
const INPUT_COLUMNS =
  'v.id, v.filename, v.relative_path, v.source, v.external_playlist_title, v.description, ' +
  'v.equipment, v.training_type, v.body_parts, v.intensity, v.duration_seconds';

/** Bumped when the prompt or the fields change, so every profile is redone once. */
const PROFILE_VERSION = '3';

function fingerprint(video: VideoInput): string {
  const parts = [
    PROFILE_VERSION,
    video.filename,
    folderOf(video),
    video.description ?? '',
    video.equipment ?? '',
    video.training_type ?? '',
    video.body_parts ?? '',
    video.intensity ?? '',
    String(video.duration_seconds ?? ''),
  ];
  return crypto.createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/** The folder path a local video sits in, or the playlist an import came from. */
function folderOf(video: VideoInput): string {
  if ((video.source || 'local') !== 'local') return video.external_playlist_title || '';
  const parts = (video.relative_path || '').split('/').filter(Boolean);
  return parts.slice(0, -1).join(' / ');
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Older rows store a bare string rather than a JSON list.
    return raw.trim() ? [raw.trim()] : [];
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every video in a profile's library, with its current profile row if any. */
const libraryStmt = db.prepare(`
  SELECT ${INPUT_COLUMNS}, p.fingerprint AS p_fingerprint, p.status AS p_status, p.attempts AS p_attempts
  FROM profile_videos pv
  JOIN videos v ON v.id = pv.video_id
  LEFT JOIN video_profiles p ON p.video_id = v.id
  WHERE pv.profile_id = ? AND pv.in_library = 1
`);

type LibraryRow = VideoInput & {
  p_fingerprint: string | null;
  p_status: string | null;
  p_attempts: number | null;
};

/** Whether a video needs (re)profiling: no profile, inputs changed, or a retryable failure. */
function needsWork(row: LibraryRow, print: string): boolean {
  if (!row.p_fingerprint || row.p_fingerprint !== print) return true;
  return row.p_status === 'failed' && (row.p_attempts ?? 0) < MAX_ATTEMPTS;
}

const saveStmt = db.prepare(`
  INSERT INTO video_profiles
    (video_id, fingerprint, status, impact, level, work_minutes, has_warmup, has_cooldown,
     good_for, notes, confidence, attempts, model, updated_at)
  VALUES (@video_id, @fingerprint, 'done', @impact, @level, @work_minutes, @has_warmup, @has_cooldown,
     @good_for, @notes, @confidence, 0, @model, CURRENT_TIMESTAMP)
  ON CONFLICT(video_id) DO UPDATE SET
    fingerprint = excluded.fingerprint, status = 'done', impact = excluded.impact,
    level = excluded.level, work_minutes = excluded.work_minutes,
    has_warmup = excluded.has_warmup, has_cooldown = excluded.has_cooldown,
    good_for = excluded.good_for, notes = excluded.notes, confidence = excluded.confidence,
    attempts = 0, model = excluded.model, updated_at = CURRENT_TIMESTAMP
`);

/**
 * Record an unusable reply. A video whose inputs changed since its last
 * attempt starts counting again; otherwise the count goes up until it stops
 * being retried. Profile fields from an earlier success are left in place —
 * slightly out of date beats nothing — and the builder still reads them.
 */
const failStmt = db.prepare(`
  INSERT INTO video_profiles (video_id, fingerprint, status, attempts, model, updated_at)
  VALUES (?, ?, 'failed', 1, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(video_id) DO UPDATE SET
    attempts = CASE WHEN video_profiles.fingerprint = excluded.fingerprint
                    THEN video_profiles.attempts + 1 ELSE 1 END,
    status = 'failed',
    fingerprint = excluded.fingerprint,
    updated_at = CURRENT_TIMESTAMP
`);

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = () => `You profile home workout videos for a plan builder. You never see the video itself, only its title, folder, length, description and the tags its owner gave it.

For each video, work out:
- impact: "low" (no jumping, joint-friendly), "medium" (some jumps or fast footwork), or "high" (lots of jumping, plyometrics, sprinting).
- level: "beginner", "intermediate", "advanced", or "all" when it suits most people.
- work_minutes: minutes of actual main training, leaving out intro, warm-up, cool-down, stretching and outro. If the description gives a structure, use it. Otherwise, for a video that has a warm-up and cool-down, subtract about 5–8 minutes for each plus 1–2 for intro and outro — a 45-minute full session is typically about 30 minutes of main work. Short blocks with neither are nearly all work.
- has_warmup / has_cooldown: true only if the video clearly includes one. Full-length sessions (roughly 30 minutes or more) usually include both; short blocks usually include neither.
- good_for: one to three short English phrases on where it fits in a plan, e.g. "main session", "short add-on", "warm-up", "recovery day", "lower-body day".
- notes: one short English sentence a coach would find useful. Do not repeat the tags.
- confidence: "high" when the description or title makes it clear, "medium" when it is a reasonable inference, "low" when you are mostly guessing.
- add_types: any of ${JSON.stringify(SUGGESTABLE_TYPES)} that clearly apply and are not already in its tags — e.g. "Dance" for a dance or Zumba workout, "Kids" for a workout made for children, "Body & Mind" for relaxation, breathing or meditation. Usually an empty list.
- add_body: any of ${JSON.stringify(SUGGESTABLE_BODY_PARTS)} that are a clear focus and not already tagged. Usually an empty list.

Rules:
- The owner's tags are correct. Build on them; never contradict them.
- Titles and descriptions may be in any language. Understand them, but answer in English.
- Never invent specific exercises or facts that are not suggested by the input.`;

interface ProfileResult {
  impact: string | null;
  level: string | null;
  work_minutes: number | null;
  has_warmup: number | null;
  has_cooldown: number | null;
  good_for: string;
  notes: string;
  confidence: string;
  addTypes: string[];
  addBody: string[];
}

function describeForModel(video: VideoInput) {
  const minutes = video.duration_seconds ? Math.round(video.duration_seconds / 60) : null;
  return {
    id: video.id,
    title: video.filename.replace(/\.[^/.]+$/, ''),
    folder: folderOf(video) || undefined,
    minutes: minutes ?? undefined,
    tags: {
      type: parseList(video.training_type),
      body: parseList(video.body_parts),
      intensity: video.intensity || undefined,
      equipment: parseList(video.equipment),
    },
    description: video.description?.trim()
      ? video.description.trim().slice(0, MAX_DESCRIPTION_CHARS)
      : undefined,
  };
}

async function profileBatch(batch: VideoInput[], model: string): Promise<Map<string, ProfileResult>> {
  const reply = await callModel({
    model,
    system: SYSTEM_PROMPT(),
    user:
      'Profile each video below. Reply with JSON only, no code fences, in exactly this shape, ' +
      'one entry per video, using the same ids:\n' +
      '{"results":[{"id":"...","impact":"low","level":"all","work_minutes":20,"has_warmup":true,' +
      '"has_cooldown":true,"good_for":["main session"],"notes":"...","confidence":"medium","add_types":[],"add_body":[]}]}\n\n' +
      JSON.stringify(batch.map(describeForModel)),
  });

  const parsed = parseJson(reply);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const byId = new Map(batch.map(video => [video.id, video]));
  const out = new Map<string, ProfileResult>();

  for (const entry of results) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    const video = byId.get(id);
    if (!video || out.has(id)) continue;
    const result = validate(entry, video);
    if (result) out.set(id, result);
  }
  return out;
}

/** Keep only well-formed values; a reply missing the essentials counts as a failure. */
function validate(entry: any, video: VideoInput): ProfileResult | null {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value.toLowerCase())
      ? (value.toLowerCase() as T)
      : null;

  const impact = pick(entry.impact, IMPACTS);
  const level = pick(entry.level, LEVELS);
  const confidence = pick(entry.confidence, CONFIDENCES) ?? 'low';
  if (!impact && !level) return null;

  // Work time can't exceed the video, and a value of 0 is just noise.
  const total = video.duration_seconds ? Math.round(video.duration_seconds / 60) : null;
  let work = Number.isFinite(entry.work_minutes) ? Math.round(entry.work_minutes) : null;
  if (work !== null && (work <= 0 || (total !== null && work > total))) work = total;

  const bool = (value: unknown) => (typeof value === 'boolean' ? (value ? 1 : 0) : null);
  const goodFor = Array.isArray(entry.good_for)
    ? entry.good_for.filter((s: unknown): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s: string) => s.trim().slice(0, 40)).slice(0, 3)
    : [];

  return {
    impact,
    level,
    work_minutes: work,
    has_warmup: bool(entry.has_warmup),
    has_cooldown: bool(entry.has_cooldown),
    good_for: JSON.stringify(goodFor),
    notes: typeof entry.notes === 'string' ? entry.notes.trim().slice(0, 300) : '',
    confidence,
    addTypes: pickList(entry.add_types, SUGGESTABLE_TYPES),
    addBody: pickList(entry.add_body, SUGGESTABLE_BODY_PARTS),
  };
}

function pickList(value: unknown, allowed: string[]): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && allowed.includes(v)))] : [];
}

function parseJson(raw: string): any {
  const withoutFence = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  const slice = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
  try {
    return JSON.parse(slice);
  } catch {
    throw new AiError('The model did not return usable JSON.', 'unparsable');
  }
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

/** Per app profile: the last error that stopped its run, and when to try again. */
const backoff = new Map<string, { until: number; error: string }>();
let running = false;
let wake: (() => void) | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * Ask the worker to look for work now rather than at its next idle check —
 * used when the setting is switched on. Edited or newly added videos don't
 * need this: the next idle check spots their changed fingerprint.
 */
export function nudgeVideoProfiler(profileId?: string): void {
  if (profileId) backoff.delete(profileId);
  wake?.();
}

export function startVideoProfiler(): void {
  if (timer) return;
  timer = setTimeout(() => void loop(), START_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      if (wake === done) wake = null;
      resolve();
    }
    wake = done;
  });
}

async function loop(): Promise<void> {
  for (;;) {
    let didWork = false;
    try {
      running = true;
      didWork = await runOnce();
    } catch (err) {
      console.error('[VideoProfiles] Worker error', err);
    } finally {
      running = false;
    }
    await sleep(didWork ? BATCH_PAUSE_MS : IDLE_MS);
  }
}

const profilesStmt = db.prepare(`
  SELECT profile_id FROM profile_settings WHERE key = ? AND value = '1'
`);

/**
 * Process one batch for the first profile that has work. Returns whether a
 * batch ran, so the loop knows to come straight back for the next one.
 */
async function runOnce(): Promise<boolean> {
  const enabled = (profilesStmt.all(`ai_${VIDEO_PROFILES_SETTING}`) as { profile_id: string }[])
    .map(row => row.profile_id);

  for (const profileId of enabled) {
    const blocked = backoff.get(profileId);
    if (blocked && blocked.until > Date.now()) continue;

    const ran = await aiProfile.run(profileId, async () => {
      const settings = getAiSettings();
      if (!isAiConfigured(settings)) return false;

      const batch = pendingFor(profileId).slice(0, BATCH_SIZE);
      if (batch.length === 0) return false;

      const model = profilingModel(settings);
      try {
        const results = await profileBatch(batch.map(item => item.video), model);
        for (const { video, print } of batch) {
          const result = results.get(video.id);
          if (result) {
            const { addTypes, addBody, ...fields } = result;
            const finalPrint = applySuggestions(video.id, result.level, addTypes, addBody) ?? print;
            saveStmt.run({ video_id: video.id, fingerprint: finalPrint, model, ...fields });
          } else {
            failStmt.run(video.id, print, model);
          }
        }
        backoff.delete(profileId);
      } catch (err) {
        if (err instanceof AiError && STOP_CODES.has(err.code)) {
          backoff.set(profileId, { until: Date.now() + ERROR_BACKOFF_MS, error: err.message });
          return false;
        }
        // A garbled reply for one batch: count it against those videos and move on.
        for (const { video, print } of batch) failStmt.run(video.id, print, model);
      }
      return true;
    });

    if (ran) return true;
  }
  return false;
}

const videoRowStmt = db.prepare(`SELECT ${INPUT_COLUMNS}, v.level AS level FROM videos v WHERE v.id = ?`);
const suggestedStmt = db.prepare('SELECT suggested FROM video_profiles WHERE video_id = ?');
const setSuggestedStmt = db.prepare(`
  INSERT INTO video_profiles (video_id, fingerprint, status, suggested) VALUES (?, '', 'failed', ?)
  ON CONFLICT(video_id) DO UPDATE SET suggested = excluded.suggested
`);

/**
 * Write the profiler's suggestions onto the video: a level where none is set,
 * and new-vocabulary tags it has never added before. Returns the fingerprint
 * of the video as it now stands — the tags just added are part of its inputs,
 * and fingerprinting the old row would queue it straight back up.
 */
function applySuggestions(videoId: string, level: string | null, addTypes: string[], addBody: string[]): string | null {
  const row = videoRowStmt.get(videoId) as (VideoInput & { level: string | null }) | undefined;
  if (!row) return null;

  const already = new Set<string>(parseList((suggestedStmt.get(videoId) as { suggested?: string } | undefined)?.suggested ?? '[]'));
  const types = parseList(row.training_type);
  const body = parseList(row.body_parts);
  const newTypes = addTypes.filter(tag => !types.includes(tag) && !already.has(`type:${tag}`));
  const newBody = addBody.filter(tag => !body.includes(tag) && !already.has(`body:${tag}`));

  db.transaction(() => {
    if (newTypes.length) db.prepare('UPDATE videos SET training_type = ? WHERE id = ?').run(JSON.stringify([...types, ...newTypes]), videoId);
    if (newBody.length) db.prepare('UPDATE videos SET body_parts = ? WHERE id = ?').run(JSON.stringify([...body, ...newBody]), videoId);
    if (!row.level && level) {
      db.prepare('UPDATE videos SET level = ? WHERE id = ? AND (level IS NULL OR level = \'\')').run(level, videoId);
    }
    if (newTypes.length || newBody.length) {
      const next = [...already, ...newTypes.map(t => `type:${t}`), ...newBody.map(b => `body:${b}`)];
      setSuggestedStmt.run(videoId, JSON.stringify(next));
    }
  })();

  const updated = videoRowStmt.get(videoId) as VideoInput | undefined;
  return updated ? fingerprint(updated) : null;
}

function pendingFor(profileId: string): { video: VideoInput; print: string }[] {
  const rows = libraryStmt.all(profileId) as LibraryRow[];
  const out: { video: VideoInput; print: string }[] = [];
  for (const row of rows) {
    const print = fingerprint(row);
    if (needsWork(row, print)) out.push({ video: row, print });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status, for the one quiet line in AI settings
// ---------------------------------------------------------------------------

export interface VideoProfileStatus {
  total: number;
  done: number;
  /** Profiled, but from details that have since changed; being redone. */
  stale: number;
  /** Gave up after repeated unusable replies. */
  failed: number;
  running: boolean;
  error: string | null;
}

export function videoProfileStatus(profileId: string): VideoProfileStatus {
  const rows = libraryStmt.all(profileId) as LibraryRow[];
  let done = 0;
  let stale = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.p_fingerprint) continue;
    const current = row.p_fingerprint === fingerprint(row);
    if (!current) stale += 1;
    else if (row.p_status === 'done') done += 1;
    else if ((row.p_attempts ?? 0) >= MAX_ATTEMPTS) failed += 1;
  }
  const blocked = backoff.get(profileId);
  return {
    total: rows.length,
    done,
    stale,
    failed,
    running,
    error: blocked && blocked.until > Date.now() ? blocked.error : null,
  };
}

// ---------------------------------------------------------------------------
// Read side, for the plan builder
// ---------------------------------------------------------------------------

export interface VideoProfile {
  impact: string | null;
  level: string | null;
  workMinutes: number | null;
  warmup: boolean | null;
  cooldown: boolean | null;
  goodFor: string[];
  notes: string;
  confidence: string | null;
}

/**
 * Profiles for the given videos. Includes ones from slightly older details —
 * a profile made before a tag edit is still far better than none, and the
 * worker is already redoing it.
 */
export function getVideoProfiles(videoIds: string[]): Map<string, VideoProfile> {
  const out = new Map<string, VideoProfile>();
  if (videoIds.length === 0) return out;
  const rows = db.prepare(`
    SELECT video_id, impact, level, work_minutes, has_warmup, has_cooldown, good_for, notes, confidence
    FROM video_profiles
    WHERE (impact IS NOT NULL OR level IS NOT NULL) AND video_id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(videoIds)) as any[];
  for (const row of rows) {
    out.set(row.video_id, {
      impact: row.impact,
      level: row.level,
      workMinutes: row.work_minutes,
      warmup: row.has_warmup === null ? null : Boolean(row.has_warmup),
      cooldown: row.has_cooldown === null ? null : Boolean(row.has_cooldown),
      goodFor: parseList(row.good_for),
      notes: row.notes || '',
      confidence: row.confidence,
    });
  }
  return out;
}
