import { beforeAll, describe, expect, it } from 'vitest';
import db from '../src/db.js';
import {
  analyzeImport, PLAN_EXPORT_FORMAT, PLAN_EXPORT_VERSION, validateExportFile,
  type ExportedPlan, type ExportedVideo, type PlanExportFile,
} from '../src/planTransfer.js';
import { seedVideo, snapshotDatabase } from './helpers.js';

const fileWith = (...plans: Partial<ExportedPlan>[]): PlanExportFile => ({
  format: PLAN_EXPORT_FORMAT,
  version: PLAN_EXPORT_VERSION,
  exportedAt: '2026-01-01T00:00:00.000Z',
  appVersion: 'test',
  plans: plans.map(plan => ({
    name: 'Plan', category: null, description: null, workoutPattern: null, backgroundBlur: 0, workouts: [],
    ...plan,
  })),
});

const day = (...videos: ExportedVideo[]) => ({ name: 'Day', sequenceOrder: 0, videos });
const local = (title: string, relativePath?: string): ExportedVideo => ({ source: 'local', title, relativePath });
const youtube = (externalId: string | undefined, playlist?: string): ExportedVideo => ({
  source: 'youtube', title: `YT ${externalId}`, externalId,
  externalPlaylistId: playlist ?? null, externalPlaylistTitle: playlist ? `${playlist} title` : null,
});

describe('validateExportFile', () => {
  const valid = fileWith({ name: 'Legs', workouts: [day(local('a.mp4'))] });

  it('accepts a well-formed file', () => {
    expect(validateExportFile(valid)).toEqual({ ok: true, file: valid });
  });

  it('accepts a file exported before the rename to HomeWorkoutHero', () => {
    const old = { ...valid, format: 'myfitnessplan.plan' };
    expect(validateExportFile(old)).toEqual({ ok: true, file: old });
  });

  it.each([
    ['nothing', null, 'not_a_plan_file'],
    ['a string', 'plan', 'not_a_plan_file'],
    ['another format', { ...valid, format: 'something.else' }, 'not_a_plan_file'],
    ['a newer version', { ...valid, version: PLAN_EXPORT_VERSION + 1 }, 'newer_version'],
    ['no version', { ...valid, version: undefined }, 'newer_version'],
    ['no plans', { ...valid, plans: [] }, 'no_plans'],
    ['plans that are not a list', { ...valid, plans: {} }, 'no_plans'],
    ['a plan without a name', { ...valid, plans: [{ workouts: [] }] }, 'not_a_plan_file'],
    ['a plan without workouts', { ...valid, plans: [{ name: 'x' }] }, 'not_a_plan_file'],
    ['a workout without videos', { ...valid, plans: [{ name: 'x', workouts: [{ name: 'd' }] }] }, 'not_a_plan_file'],
    ['too many plans', { ...valid, plans: Array(201).fill(valid.plans[0]) }, 'too_large'],
    ['too many workouts', { ...valid, plans: [{ name: 'x', workouts: Array(2001).fill(day()) }] }, 'too_large'],
    ['too many videos', { ...valid, plans: [{ name: 'x', workouts: [day(...Array(201).fill(local('a')))] }] }, 'too_large'],
  ])('rejects %s', (_label, data, error) => {
    expect(validateExportFile(data)).toEqual({ ok: false, error });
  });
});

describe('analyzeImport', () => {
  beforeAll(() => {
    db.prepare("INSERT INTO profiles (id, name, setup_done) VALUES ('other', 'Other', 1)").run();
    seedVideo({ id: 'legs', filename: 'Legs.mp4', relativePath: 'Strength/Legs.mp4' });
    seedVideo({ id: 'core', filename: 'Core.mp4', relativePath: 'Core.mp4' });
    seedVideo({ id: 'yt-known', filename: 'Known', source: 'youtube', externalId: 'known' });
    // Someone else's file: not in this profile's library, so it can't be used.
    seedVideo({ id: 'arms', filename: 'Arms.mp4' }, ['other']);
    db.prepare("INSERT INTO workout_plans (id, profile_id, name) VALUES ('mine', 'p1', 'Push')").run();
    db.prepare("INSERT INTO workout_plans (id, profile_id, name) VALUES ('theirs', 'other', 'Pull')").run();
  });

  it('sorts each video into matched, will-create or missing', () => {
    const [report] = analyzeImport('p1', fileWith({
      name: 'Mixed',
      workouts: [
        day(local('Legs.mp4', 'Strength/Legs.mp4'), local('Core.mp4', 'Elsewhere/Core.mp4')),
        day(youtube('known'), youtube('new', 'PL1')),
        day(local('Arms.mp4'), youtube(undefined)),
      ],
    }));

    expect(report).toEqual({
      name: 'Mixed',
      importedAs: 'Mixed',
      workoutCount: 3,
      videoCount: 6,
      matched: 3, // by path, by filename, and by YouTube id
      willCreate: 1,
      missing: 2, // another profile's file, and a YouTube ref with no id
      missingTitles: ['Arms.mp4', 'YT undefined'],
      playlists: [{ id: 'PL1', title: 'PL1 title', inLibrary: false }],
    });
  });

  it("flags playlists already in this profile's library, not someone else's", () => {
    seedVideo({ id: 'pl-mine', filename: 'Mine', source: 'youtube', externalId: 'pl-mine' });
    seedVideo({ id: 'pl-theirs', filename: 'Theirs', source: 'youtube', externalId: 'pl-theirs' }, ['other']);
    db.prepare("UPDATE videos SET external_playlist_id = 'PL-MINE' WHERE id = 'pl-mine'").run();
    db.prepare("UPDATE videos SET external_playlist_id = 'PL-THEIRS' WHERE id = 'pl-theirs'").run();

    const [report] = analyzeImport('p1', fileWith({
      workouts: [day(youtube('a', 'PL-MINE'), youtube('b', 'PL-THEIRS'))],
    }));
    expect(report.playlists).toEqual([
      { id: 'PL-MINE', title: 'PL-MINE title', inLibrary: true },
      { id: 'PL-THEIRS', title: 'PL-THEIRS title', inLibrary: false },
    ]);
  });

  it('never reuses a name, within the file or among existing plans', () => {
    const reports = analyzeImport('p1', fileWith({ name: 'Push' }, { name: 'Legs' }, { name: 'Legs' }, { name: 'Push' }));
    expect(reports.map(r => r.importedAs)).toEqual(['Push (2)', 'Legs', 'Legs (2)', 'Push (3)']);
  });

  it("ignores other profiles' plan names", () => {
    expect(analyzeImport('p1', fileWith({ name: 'Pull' }))[0].importedAs).toBe('Pull');
  });

  it('lists at most 20 missing titles', () => {
    const missing = Array.from({ length: 25 }, (_, i) => local(`Gone ${i}.mp4`));
    const [report] = analyzeImport('p1', fileWith({ workouts: [day(...missing)] }));
    expect(report.missing).toBe(25);
    expect(report.missingTitles).toHaveLength(20);
  });

  it('writes nothing', () => {
    const before = snapshotDatabase();
    analyzeImport('p1', fileWith({ name: 'Push', workouts: [day(youtube('brand-new', 'PL9'), local('Legs.mp4'))] }));
    expect(snapshotDatabase()).toEqual(before);
  });
});
