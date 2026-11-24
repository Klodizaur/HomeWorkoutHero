import fs from 'fs';
import { getProfileSetting, listProfiles } from './profiles.js';
import { isScanRunning, runLibraryScan } from './routes/library.js';

/**
 * Optional automatic library scans, set per profile in Settings → Workouts:
 *   off     — only when someone presses Scan / Rescan (the default)
 *   startup — once, shortly after the app starts
 *   hourly  — after the app starts, then every hour while it runs
 *
 * Scans run one after another, never alongside a scan someone started by hand.
 * A folder that isn't there right now (an unplugged drive) is skipped rather
 * than scanned, so auto-scan can never empty a library.
 */
export const AUTO_SCAN_MODES = ['off', 'startup', 'hourly'] as const;
export type AutoScanMode = typeof AUTO_SCAN_MODES[number];

export function autoScanMode(profileId: string): AutoScanMode {
  const value = getProfileSetting(profileId, 'auto_scan');
  return (AUTO_SCAN_MODES as readonly string[]).includes(value ?? '') ? (value as AutoScanMode) : 'off';
}

const STARTUP_DELAY_MS = 20_000;
const HOUR_MS = 60 * 60 * 1000;

let started = false;

async function scanProfiles(modes: AutoScanMode[]): Promise<void> {
  for (const profile of listProfiles()) {
    if (!modes.includes(autoScanMode(profile.id))) continue;
    const dir = getProfileSetting(profile.id, 'video_directory');
    if (!dir) continue;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    // Someone pressed Scan meanwhile: theirs wins, this one waits for the next round.
    if (isScanRunning()) return;
    try {
      await runLibraryScan(profile.id, dir, 'auto');
    } catch (err) {
      console.error(`[AutoScan] Scan for profile ${profile.id} failed:`, err);
    }
  }
}

export function startAutoScan(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    scanProfiles(['startup', 'hourly']).catch(() => {});
    setInterval(() => { scanProfiles(['hourly']).catch(() => {}); }, HOUR_MS).unref();
  }, STARTUP_DELAY_MS).unref();
}
