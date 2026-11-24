/** A length typed by hand (a placeholder day, a logged workout without a video). */

const MAX_MINUTES = 600;

/** Whole minutes from 1 to 10 hours, or none. */
export function parseMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_MINUTES) : null;
}
