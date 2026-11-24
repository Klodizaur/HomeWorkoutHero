/**
 * The tag vocabularies: the built-in lists, plus tags people add themselves.
 *
 * Built-in values are canonical ids ('dumbbells', 'full_body') or, for training
 * types, the stored English name ('HIIT'); the client translates them. A
 * custom tag is stored exactly as its author typed it, since there is no
 * translation to look up, and it is shared across profiles because the videos
 * it labels are.
 */
import db from './db.js';

export const VALID_EQUIPMENT = [
  'dumbbells',
  'mat',
  'gym_ball',
  'resistance_bands',
  'mini_bands',
  'pilates_ball',
  'pilates_bar',
  'kettlebell',
  'barbell',
  'medicine_ball',
  'ankle_weights',
  'jump_rope',
  'ab_roller',
  'pull_up_bar',
  'weighted_hula_hoop',
  'trampoline',
  'treadmill',
  'exercise_bike',
  'rowing_machine',
  'step',
  'bench',
  'chair',
  'yoga_block',
  'foam_roller',
  'sliders',
  // Bodyweight-only. A tag rather than the absence of one, so "needs nothing"
  // is something a video can actually say.
  'no_equipment',
] as const;

/**
 * Training types, in three kinds that the interface shows as separate groups:
 * what the workout is, a part of a session, and who or what it suits. Stored
 * together on `training_type` so older rows and filters keep working.
 */
export const TRAINING_TYPE_GROUPS = {
  type: ['HIIT', 'Tabata', 'Circuit', 'Cardio', 'Dance', 'Aerobics', 'Boxing', 'Walking', 'Treadmill', 'Indoor Cycling', 'Strength', 'Functional Strength Training', 'Calisthenics', 'Pilates', 'Barre', 'Yoga', 'Mobility', 'Stretching', 'Body & Mind', 'Kids'],
  part: ['Warmup', 'Finisher', 'Cooldown'],
  suits: ['Standing', 'No Jumping', 'Quiet', 'Seated', 'Period-Friendly', 'Prenatal', 'Postnatal', 'Seniors'],
} as const;
export const VALID_TRAINING_TYPES = [
  ...TRAINING_TYPE_GROUPS.type,
  ...TRAINING_TYPE_GROUPS.part,
  ...TRAINING_TYPE_GROUPS.suits,
] as const;
export const VALID_BODY_PARTS = ['full_body', 'upper_body', 'lower_body', 'core', 'back', 'legs', 'arms', 'shoulders', 'glutes', 'chest', 'hips', 'pelvic_floor', 'neck'] as const;
export const VALID_INTENSITIES = ['low', 'medium', 'high'] as const;
export const VALID_LEVELS = ['beginner', 'intermediate', 'advanced', 'all'] as const;

export type TagKind = 'training_type' | 'body_part' | 'equipment';
export const TAG_KINDS: readonly TagKind[] = ['training_type', 'body_part', 'equipment'];

const BUILT_IN: Record<TagKind, readonly string[]> = {
  training_type: VALID_TRAINING_TYPES,
  body_part: VALID_BODY_PARTS,
  equipment: VALID_EQUIPMENT,
};

/** The video column each kind is stored in. */
const COLUMN: Record<TagKind, string> = {
  training_type: 'training_type',
  body_part: 'body_parts',
  equipment: 'equipment',
};

const MAX_LABEL = 32;

const listStmt = db.prepare('SELECT kind, value FROM custom_tags ORDER BY created_at, value');
const insertStmt = db.prepare('INSERT OR IGNORE INTO custom_tags (kind, value) VALUES (?, ?)');
const deleteStmt = db.prepare('DELETE FROM custom_tags WHERE kind = ? AND value = ?');

/**
 * Custom tags, cached: every video row is filtered through `isKnownTag`, so a
 * query per check would multiply across a whole library listing.
 */
let cache: Record<TagKind, Set<string>> | null = null;

function custom(): Record<TagKind, Set<string>> {
  if (cache) return cache;
  const next: Record<TagKind, Set<string>> = { training_type: new Set(), body_part: new Set(), equipment: new Set() };
  for (const row of listStmt.all() as { kind: string; value: string }[]) {
    if (row.kind in next) next[row.kind as TagKind].add(row.value);
  }
  cache = next;
  return next;
}

export function isTagKind(value: unknown): value is TagKind {
  return typeof value === 'string' && (TAG_KINDS as readonly string[]).includes(value);
}

/** Whether a value is a tag of this kind, built in or added by someone. */
export function isKnownTag(kind: TagKind, value: unknown): value is string {
  return typeof value === 'string' && (BUILT_IN[kind].includes(value) || custom()[kind].has(value));
}

export function listCustomTags(): Record<TagKind, string[]> {
  const sets = custom();
  return {
    training_type: [...sets.training_type],
    body_part: [...sets.body_part],
    equipment: [...sets.equipment],
  };
}

export class TagError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/**
 * Add a tag. Returns the stored value — an existing tag's, when the label
 * only differs from one in case or spacing, so "dance" never sits beside the
 * built-in "Dance".
 */
export function addCustomTag(kind: TagKind, label: string): string {
  const clean = label.replace(/\s+/g, ' ').trim();
  if (!clean) throw new TagError('Give the tag a name.', 'empty');
  if (clean.length > MAX_LABEL) throw new TagError(`Keep it under ${MAX_LABEL} characters.`, 'too_long');

  const folded = fold(clean);
  const existing = [...BUILT_IN[kind], ...custom()[kind]].find(value => fold(value) === folded);
  if (existing) return existing;

  insertStmt.run(kind, clean);
  cache = null;
  return clean;
}

/**
 * Remove a custom tag and take it off every video that has it, so no video is
 * left carrying a tag that no longer exists anywhere to pick or filter by.
 * Built-in tags can't be removed. Returns how many videos lost the tag.
 */
export function removeCustomTag(kind: TagKind, value: string): number {
  if (!custom()[kind].has(value)) throw new TagError('No such tag.', 'not_found');
  const column = COLUMN[kind];
  let changed = 0;
  db.transaction(() => {
    const rows = db.prepare(`SELECT id, ${column} AS tags FROM videos WHERE ${column} LIKE ?`)
      .all(`%${value.replace(/[%_]/g, '')}%`) as { id: string; tags: string | null }[];
    const update = db.prepare(`UPDATE videos SET ${column} = ? WHERE id = ?`);
    for (const row of rows) {
      let list: unknown;
      try { list = JSON.parse(row.tags || '[]'); } catch { continue; }
      if (!Array.isArray(list) || !list.includes(value)) continue;
      update.run(JSON.stringify(list.filter(item => item !== value)), row.id);
      changed += 1;
    }
    deleteStmt.run(kind, value);
  })();
  cache = null;
  return changed;
}

/** Comparison key: case, spacing, hyphens and diacritics don't make a new tag. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}
