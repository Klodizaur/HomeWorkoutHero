/**
 * A plan can be done more than once. Each time through is a run: its ticks live
 * in `history`, its finish (if any) in `plan_completions`, and what you did in
 * `workout_log`. Starting a finished plan again begins a new run.
 */
import { nanoid } from 'nanoid';
import db from './db.js';

function parseIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Whether every workout day in a plan is marked done — order irrelevant, since
 * this asks "are any left?", not "was the last one done?".
 *
 * A day counts by the same rule the schedule uses: it has a day-level mark, or
 * all of its videos are marked.
 */
export function isPlanComplete(planId: string): { complete: boolean; workoutCount: number } {
  const workouts = db.prepare('SELECT id, video_ids FROM workouts WHERE plan_id = ?').all(planId) as { id: string; video_ids: string | null }[];
  if (workouts.length === 0) return { complete: false, workoutCount: 0 };

  const marks = db.prepare(`
    SELECT workout_id, video_id FROM history
    WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)
  `).all(planId) as { workout_id: string; video_id: string | null }[];
  const dayMarks = new Set(marks.filter(h => !h.video_id).map(h => h.workout_id));
  const videoMarks = new Set(marks.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

  const complete = workouts.every(w => {
    if (dayMarks.has(w.id)) return true;
    const ids = parseIds(w.video_ids);
    return ids.length > 0 && ids.every(vid => videoMarks.has(`${w.id}:${vid}`));
  });
  return { complete, workoutCount: workouts.length };
}

/**
 * Begin a fresh run of a plan: its ticks are cleared so every day is open again.
 *
 * The finish stays (plan_completions isn't touched), and so does the log. The
 * old run's log rows are moved off the plan's workout ids onto a run-specific
 * key first, because the log is keyed by workout: doing a day again would
 * otherwise replace its entry from the earlier run, and a mood given then would
 * be copied onto the new one. Each old workout keeps its parts grouped under
 * its new key, so the Log shows it exactly as before.
 */
export function startNewRun(planId: string): void {
  const run = nanoid(8);
  db.transaction(() => {
    db.prepare(`
      UPDATE workout_log SET workout_id = workout_id || '#' || ?
      WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)
    `).run(run, planId);
    db.prepare('DELETE FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)').run(planId);
  })();
}
