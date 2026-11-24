/**
 * What the Log can say about workouts and mood, worked out from the entries
 * already logged — no AI, nothing sent anywhere.
 *
 * A workout counts once (all its logged videos together), and only when both a
 * before and an after mood were given. "Better" is any rise: 2 → 3 counts as
 * much as 1 → 5, since feeling a bit better is still feeling better.
 */

export const MOOD_REASONS = ['exhausting', 'too_long', 'too_easy', 'pain', 'disliked_video', 'tired_before'] as const;
export type MoodReason = typeof MOOD_REASONS[number];

export const asMoodReason = (value: unknown): MoodReason | null =>
  typeof value === 'string' && (MOOD_REASONS as readonly string[]).includes(value) ? (value as MoodReason) : null;

/** The fields of a log entry this needs (a subset of LogEntry). */
export interface MoodEntry {
  id: string;
  workoutId: string | null;
  workoutName: string | null;
  completedDate: string;
  moodBefore: number | null;
  moodAfter: number | null;
  moodReason?: string | null;
  durationSeconds: number | null;
  trainingType: string[];
  equipment: string[];
  intensity: string | null;
}

export interface MoodWorkout {
  key: string;
  before: number | null;
  after: number | null;
  reason: MoodReason | null;
  trainingType: string[];
  equipment: string[];
  intensities: string[];
  durationSeconds: number;
}

/** Same key the Log's stats use, so "a workout" means the same thing everywhere. */
export const workoutKey = (e: MoodEntry) => `${e.completedDate}|${e.workoutId || e.workoutName || e.id}`;

export function groupWorkouts(entries: MoodEntry[]): MoodWorkout[] {
  const byKey = new Map<string, MoodWorkout>();
  for (const e of entries) {
    const key = workoutKey(e);
    let w = byKey.get(key);
    if (!w) {
      w = { key, before: null, after: null, reason: null, trainingType: [], equipment: [], intensities: [], durationSeconds: 0 };
      byKey.set(key, w);
    }
    w.before ??= e.moodBefore ?? null;
    w.after ??= e.moodAfter ?? null;
    w.reason ??= asMoodReason(e.moodReason);
    for (const tt of e.trainingType || []) if (!w.trainingType.includes(tt)) w.trainingType.push(tt);
    for (const eq of e.equipment || []) if (!w.equipment.includes(eq)) w.equipment.push(eq);
    if (e.intensity && !w.intensities.includes(e.intensity)) w.intensities.push(e.intensity);
    w.durationSeconds += e.durationSeconds || 0;
  }
  return [...byKey.values()];
}

export type MoodChange = 'better' | 'same' | 'worse';
export const moodChange = (w: { before: number | null; after: number | null }): MoodChange | null =>
  w.before == null || w.after == null ? null : w.after > w.before ? 'better' : w.after < w.before ? 'worse' : 'same';

/** A low or dropped after-mood: the moment to ask what made it rough. */
export const isRoughMood = (before: number | null, after: number | null): boolean =>
  after != null && (after <= 2 || (before != null && after < before));

export interface MoodRate { key: string; better: number; total: number }

export interface MoodSummary {
  /** Workouts with both moods. */
  counted: number;
  better: number;
  same: number;
  worse: number;
  /** Types and equipment that most often lifted the mood (empty until there's enough to say). */
  bestTypes: MoodRate[];
  bestEquipment: MoodRate[];
  /** Why rough workouts felt rough, most common first. */
  reasons: { reason: MoodReason; count: number }[];
}

/** Workouts with both moods needed before naming what works best. */
export const PATTERN_MIN_WORKOUTS = 5;
/** Workouts a type or item needs before it can be called "best": one lucky day isn't a pattern. */
export const PATTERN_MIN_PER_KEY = 3;

function bestRates(workouts: MoodWorkout[], keysOf: (w: MoodWorkout) => string[], limit = 2): MoodRate[] {
  const rates = new Map<string, MoodRate>();
  for (const w of workouts) {
    const better = moodChange(w) === 'better';
    for (const key of keysOf(w)) {
      const r = rates.get(key) || { key, better: 0, total: 0 };
      r.total++;
      if (better) r.better++;
      rates.set(key, r);
    }
  }
  return [...rates.values()]
    // "Best" means it helped at least half the time, not just that it's done a lot.
    .filter(r => r.total >= PATTERN_MIN_PER_KEY && r.better * 2 >= r.total)
    // By how often it helped, then by how much evidence there is.
    .sort((a, b) => b.better / b.total - a.better / a.total || b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function moodSummary(entries: MoodEntry[]): MoodSummary {
  const workouts = groupWorkouts(entries);
  const paired = workouts.filter(w => moodChange(w) !== null);
  const count = (c: MoodChange) => paired.filter(w => moodChange(w) === c).length;
  const enough = paired.length >= PATTERN_MIN_WORKOUTS;

  const reasonCounts = new Map<MoodReason, number>();
  for (const w of workouts) if (w.reason) reasonCounts.set(w.reason, (reasonCounts.get(w.reason) || 0) + 1);

  return {
    counted: paired.length,
    better: count('better'),
    same: count('same'),
    worse: count('worse'),
    bestTypes: enough ? bestRates(paired, w => w.trainingType) : [],
    bestEquipment: enough ? bestRates(paired, w => w.equipment) : [],
    reasons: [...reasonCounts.entries()]
      .map(([reason, n]) => ({ reason, count: n }))
      .sort((a, b) => b.count - a.count),
  };
}

// --- Hints after a rough workout --------------------------------------------------

/** A hint as a translation key and its values; the dialog turns it into text. */
export interface MoodHint { key: string; values?: Record<string, string | number> }

const WEIGHTS = new Set(['dumbbells', 'kettlebell', 'barbell', 'medicine_ball', 'ankle_weights', 'weighted_hula_hoop']);
const HARD_TYPES = new Set(['HIIT', 'Tabata', 'Circuit', 'Boxing']);

/**
 * What to try next time, for the reason picked and the workout it was about.
 * `history` is the rest of the log, used to point at what has felt good before.
 */
export function moodHints(reason: MoodReason, workout: MoodWorkout, history: MoodEntry[]): MoodHint[] {
  const hints: MoodHint[] = [];
  switch (reason) {
    case 'exhausting':
      if (workout.equipment.some(e => WEIGHTS.has(e))) hints.push({ key: 'lighter_weights' });
      if (workout.intensities.includes('high') || workout.trainingType.some(tt => HARD_TYPES.has(tt))) hints.push({ key: 'lower_intensity' });
      hints.push({ key: 'breaks' });
      hints.push({ key: 'experienced' });
      break;
    case 'too_long': {
      const minutes = Math.round(workout.durationSeconds / 60);
      hints.push(minutes >= 10 ? { key: 'shorter', values: { minutes } } : { key: 'shorter_any' });
      hints.push({ key: 'short_counts' });
      break;
    }
    case 'too_easy': {
      const best = moodSummary(history).bestTypes.find(r => !workout.trainingType.includes(r.key));
      if (best) hints.push({ key: 'best_type', values: { type: best.key, better: best.better, total: best.total } });
      hints.push({ key: 'step_up' });
      break;
    }
    case 'pain':
      hints.push({ key: 'pain' });
      hints.push({ key: 'low_impact' });
      break;
    case 'disliked_video':
      hints.push({ key: 'swap_video' });
      break;
    case 'tired_before':
      hints.push({ key: 'tired' });
      hints.push({ key: 'rest_ok' });
      break;
  }
  return hints;
}
