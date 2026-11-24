/**
 * Folders pinned to the top of the Library, per profile (saved on the server,
 * so they follow you to every device). Shared by the Library and a folder's
 * own page, so pinning in one shows in the other straight away.
 */
import { useEffect, useState } from 'react';
import { notify } from './notify';
import i18n from '../i18n';

let pins: string[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(p: string[]) => void>();

const publish = (next: string[]) => {
  pins = next;
  listeners.forEach(fn => fn(next));
};

function load(): Promise<void> {
  if (!loading) {
    loading = fetch('/api/library/pins')
      .then(r => (r.ok ? r.json() : { pins: [] }))
      .then((data: { pins?: string[] }) => publish(Array.isArray(data.pins) ? data.pins : []))
      .catch(() => publish([]))
      .finally(() => { loading = null; });
  }
  return loading;
}

/** Pins or unpins a folder; shown at once, put back if the server says no. */
export async function setPinned(key: string, pinned: boolean): Promise<void> {
  const before = pins ?? [];
  publish(pinned ? [key, ...before.filter(k => k !== key)] : before.filter(k => k !== key));
  try {
    const res = await fetch('/api/library/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, pinned }),
    });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    if (Array.isArray(data.pins)) publish(data.pins);
  } catch {
    publish(before);
    notify(i18n.t('library.pin_failed'));
  }
}

/** The pinned folder keys, newest pin first. Empty until loaded. */
export function usePinnedFolders(): string[] {
  const [value, setValue] = useState<string[]>(pins ?? []);
  useEffect(() => {
    listeners.add(setValue);
    // Fetched fresh on each mount, so a pin made on another device shows up.
    load();
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}
