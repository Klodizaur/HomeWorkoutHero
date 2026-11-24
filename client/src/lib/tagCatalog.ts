/**
 * Every tag the user can pick: the built-in lists plus the ones people added
 * themselves (shared across profiles, like the videos they label).
 *
 * One module-level copy, loaded once and refreshed whenever someone adds or
 * removes a tag, so every open picker updates together.
 */
import { useEffect, useState } from 'react';
import { EQUIPMENT_ITEMS } from './equipment';
import { BODY_PARTS, TRAINING_TYPES } from './metadata';

export type TagKind = 'training_type' | 'body_part' | 'equipment';
type CustomTags = Record<TagKind, string[]>;

const EMPTY: CustomTags = { training_type: [], body_part: [], equipment: [] };

let custom: CustomTags = EMPTY;
let loading: Promise<void> | null = null;
const listeners = new Set<(next: CustomTags) => void>();

function publish(next: CustomTags) {
  custom = next;
  listeners.forEach(listener => listener(next));
}

function load(): Promise<void> {
  if (!loading) {
    loading = fetch('/api/library/tags')
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (data?.custom) publish({ ...EMPTY, ...data.custom }); })
      .catch(() => {});
  }
  return loading;
}

/** Add a tag of this kind. Resolves to the stored value (possibly an existing tag). */
export async function addTag(kind: TagKind, label: string): Promise<{ value?: string; error?: string }> {
  const res = await fetch('/api/library/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.message || data?.error || 'error' };
  if (data?.custom) publish({ ...EMPTY, ...data.custom });
  return { value: data.value };
}

/** Remove a custom tag; resolves to how many videos lost it. */
export async function removeTag(kind: TagKind, value: string): Promise<number | null> {
  const res = await fetch('/api/library/tags', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, value }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  if (data?.custom) publish({ ...EMPTY, ...data.custom });
  return typeof data?.videos === 'number' ? data.videos : 0;
}

/** The full lists for pickers and filters: built-in first, then custom. */
export function useTagCatalog() {
  const [tags, setTags] = useState<CustomTags>(custom);

  useEffect(() => {
    listeners.add(setTags);
    void load();
    return () => { listeners.delete(setTags); };
  }, []);

  return {
    trainingTypes: [...TRAINING_TYPES, ...tags.training_type] as string[],
    bodyParts: [...BODY_PARTS, ...tags.body_part] as string[],
    equipment: [...EQUIPMENT_ITEMS.map(item => item.id as string), ...tags.equipment],
    custom: tags,
  };
}
