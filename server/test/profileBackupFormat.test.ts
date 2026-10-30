import { describe, expect, it } from 'vitest';
import { checkProfileBackup, PROFILE_BACKUP_FORMAT, PROFILE_BACKUP_VERSION } from '../src/profileBackup.js';

const backup = (format: string) => ({
  format, version: PROFILE_BACKUP_VERSION, profileId: 'p1', profileName: 'Me',
  settings: [], videos: [], plans: [], workouts: [], history: [], freezes: [], log: [], completions: [],
});

describe('checkProfileBackup format', () => {
  it('reads a current backup', () => {
    expect(checkProfileBackup(backup(PROFILE_BACKUP_FORMAT)).ok).toBe(true);
  });

  it('reads a backup made before the rename to HomeWorkoutHero', () => {
    expect(checkProfileBackup(backup('myfitnessplan.profile-backup')).ok).toBe(true);
  });

  it('turns away anything else', () => {
    expect(checkProfileBackup(backup('something.else'))).toEqual({ ok: false, error: 'not_a_backup' });
  });
});
