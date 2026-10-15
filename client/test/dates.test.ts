import { afterEach, describe, expect, it } from 'vitest';
import { localDateString } from '../src/lib/dates';

const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('localDateString', () => {
  // Far east and far west of UTC, where a UTC date is a day off around midnight.
  it.each(['Pacific/Auckland', 'America/Los_Angeles', 'UTC'])(
    "gives the user's own calendar day at either end of it (%s)",
    timezone => {
      process.env.TZ = timezone;
      expect(localDateString(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
      expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    }
  );
});
