/**
 * The library scan as every page sees it.
 *
 * One poller for the whole app, shared by the scan pop-up and the Library
 * page: quick while a scan runs, slow while nothing does (an auto-scan can
 * start at any time). When a scan of this profile's library finishes, a
 * `library-scanned` event lets open pages reload their videos.
 */
import { useEffect, useState } from 'react';

export interface ScanResult {
  count: number;
  added: number;
  removed: number;
  skippedCleanup: boolean;
  unreadableCount: number;
  error?: string;
}

export interface ScanStatus {
  active: boolean;
  phase: 'idle' | 'discovering' | 'processing' | 'done';
  processed: number;
  total: number;
  currentFile: string;
  id: number;
  trigger: 'settings' | 'library' | 'auto';
  result: ScanResult | null;
  /** Whether it's the library of the profile using this device. */
  mine: boolean;
}

export const LIBRARY_SCANNED_EVENT = 'library-scanned';

const ACTIVE_MS = 1200;
const IDLE_MS = 15000;

let status: ScanStatus | null = null;
const listeners = new Set<(s: ScanStatus | null) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function poll() {
  clearTimeout(timer);
  try {
    const res = await fetch('/api/library/scan-progress');
    if (res.ok) {
      const next = (await res.json()) as ScanStatus;
      const finished = status?.active && !next.active && status.id === next.id && next.mine;
      // A quick scan can start and end between two polls; a new id that is
      // already done still counts as finished.
      const missed = status && !status.active && next.id !== status.id && !next.active && next.mine && next.result;
      status = next;
      listeners.forEach(fn => fn(status));
      // Carries the scan's id: listeners may still hold the previous status.
      if (finished || missed) window.dispatchEvent(new CustomEvent(LIBRARY_SCANNED_EVENT, { detail: { id: next.id } }));
    }
  } catch {
    // Server unreachable for a moment; the next round tries again.
  }
  if (listeners.size > 0) timer = setTimeout(poll, status?.active ? ACTIVE_MS : IDLE_MS);
  else running = false;
}

/** Polls again now, e.g. right after starting a scan. */
export function refreshScanStatus() {
  if (listeners.size > 0) { running = true; poll(); }
}

export function useScanStatus(): ScanStatus | null {
  const [value, setValue] = useState(status);
  useEffect(() => {
    listeners.add(setValue);
    if (!running) { running = true; poll(); }
    return () => { listeners.delete(setValue); };
  }, []);
  return value;
}

/**
 * Rescans the saved folder in the background. Resolves to null once it has
 * started, or the reason it couldn't: 'busy', 'no_directory',
 * 'missing_directory' or 'failed'.
 */
export async function startRescan(): Promise<string | null> {
  try {
    const res = await fetch('/api/library/rescan', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    refreshScanStatus();
    if (res.ok) return null;
    return typeof data?.error === 'string' && res.status !== 500 ? data.error : 'failed';
  } catch {
    return 'failed';
  }
}
