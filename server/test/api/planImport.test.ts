import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { PLAN_EXPORT_FORMAT, PLAN_EXPORT_VERSION, type ExportedPlan } from '../../src/planTransfer.js';
import { buildTestApp, seedVideo, snapshotDatabase, twoProfiles } from '../helpers.js';

const exportFile = (...plans: Partial<ExportedPlan>[]) => ({
  format: PLAN_EXPORT_FORMAT,
  version: PLAN_EXPORT_VERSION,
  exportedAt: '2026-01-01T00:00:00.000Z',
  appVersion: 'test',
  plans: plans.map(plan => ({
    name: 'Plan', category: null, description: null, workoutPattern: null, backgroundBlur: 0,
    workouts: [{
      name: 'Day 1',
      sequenceOrder: 0,
      videos: [
        { source: 'youtube', title: 'Imported title', externalId: 'yt-1', equipment: ['dumbbells'], intensity: 'high' },
        { source: 'youtube', title: 'Brand new', externalId: 'yt-new', description: 'from the file' },
        { source: 'local', title: 'Not on this machine.mp4', relativePath: 'x/Not on this machine.mp4' },
      ],
    }],
    ...plan,
  })),
});

const plansOf = (profileId: string) =>
  db.prepare('SELECT * FROM workout_plans WHERE profile_id = ? ORDER BY rowid').all(profileId) as any[];
const workoutsOf = (planId: string) =>
  db.prepare('SELECT * FROM workouts WHERE plan_id = ? ORDER BY sequence_order').all(planId) as any[];

let app: FastifyInstance;
let users: Awaited<ReturnType<typeof twoProfiles>>;

beforeAll(async () => {
  app = await buildTestApp();
  users = await twoProfiles(app);
  // Alice already has this YouTube video, tagged her own way.
  seedVideo({ id: 'yt-1-row', filename: 'Her title', source: 'youtube', externalId: 'yt-1', equipment: ['mat'], intensity: 'low' });
  const created = await users.alice.post('/api/plan/create', {
    name: 'Push', startDate: '2026-01-05', days: [{ name: 'Original day', videoIds: ['yt-1-row'] }],
  });
  expect(created.statusCode).toBe(200);
});

afterAll(() => app.close());

describe('POST /api/plan/import', () => {
  it('a dry run reports what would happen and writes nothing', async () => {
    const before = snapshotDatabase();

    const res = await users.alice.post('/api/plan/import', { file: exportFile({ name: 'Push' }), dryRun: true });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      dryRun: true,
      reports: [{ name: 'Push', importedAs: 'Push (2)', matched: 1, willCreate: 1, missing: 1 }],
    });
    expect(snapshotDatabase()).toEqual(before);
  });

  it('never overwrites an existing plan: a clashing name gets a number', async () => {
    const [original] = plansOf(users.aliceId);
    const originalWorkouts = workoutsOf(original.id);

    const first = await users.alice.post('/api/plan/import', { file: exportFile({ name: 'Push' }) });
    const second = await users.alice.post('/api/plan/import', { file: exportFile({ name: 'Push' }) });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(plansOf(users.aliceId).map(p => p.name)).toEqual(['Push', 'Push (2)', 'Push (3)']);
    // The original is exactly as it was.
    expect(plansOf(users.aliceId)[0]).toEqual(original);
    expect(workoutsOf(original.id)).toEqual(originalWorkouts);
  });

  it('reuses a video it already has without touching its tags', async () => {
    const before = db.prepare("SELECT * FROM videos WHERE external_id = 'yt-1'").all();
    expect(before).toMatchObject([{ id: 'yt-1-row', filename: 'Her title', equipment: '["mat"]', intensity: 'low' }]);

    const res = await users.alice.post('/api/plan/import', { file: exportFile({ name: 'Tags' }) });
    const [planId] = res.json().planIds;

    expect(db.prepare("SELECT * FROM videos WHERE external_id = 'yt-1'").all()).toEqual(before);
    // The day points at the existing row; the missing local file is left out.
    const ids = JSON.parse(workoutsOf(planId)[0].video_ids);
    const newRow = db.prepare("SELECT id, description FROM videos WHERE external_id = 'yt-new'").get() as any;
    expect(ids).toEqual(['yt-1-row', newRow.id]);
    expect(newRow.description).toBe('from the file');
  });

  it("numbers names against the importer's own plans only", async () => {
    const res = await users.bob.post('/api/plan/import', { file: exportFile({ name: 'Push' }) });
    expect(res.json().reports[0].importedAs).toBe('Push');
    expect(plansOf(users.bobId).map(p => p.name)).toEqual(['Push']);
  });

  it('rejects a file that is not a plan export, writing nothing', async () => {
    const before = snapshotDatabase();
    const res = await users.alice.post('/api/plan/import', { file: { format: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('not_a_plan_file');
    expect(snapshotDatabase()).toEqual(before);
  });
});
