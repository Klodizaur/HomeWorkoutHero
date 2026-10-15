import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { as, buildTestApp, seedVideo, twoProfiles } from '../helpers.js';

/**
 * One install, two people. Bob must not be able to see or change anything of
 * Alice's — every request below is Bob's, aimed at Alice's things, and must
 * come back "not found" with her data exactly as it was.
 */

let app: FastifyInstance;
let users: Awaited<ReturnType<typeof twoProfiles>>;
let planId: string;

const planRow = () => db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(planId);
const workoutRows = () => db.prepare('SELECT * FROM workouts WHERE plan_id = ? ORDER BY sequence_order').all(planId);
const videoRow = () => db.prepare("SELECT * FROM videos WHERE id = 'alice-video'").get();
const libraryRows = () => db.prepare("SELECT * FROM profile_videos WHERE video_id = 'alice-video'").all();

beforeAll(async () => {
  app = await buildTestApp();
  users = await twoProfiles(app);
  seedVideo({ id: 'alice-video', filename: 'Pilates.mp4', equipment: ['mat'] }, [users.aliceId]);

  const created = await users.alice.post('/api/plan/create', {
    name: "Alice's plan", startDate: '2026-01-05', days: [{ name: 'Day 1', videoIds: ['alice-video'] }],
  });
  planId = created.json().planId;
  expect((await users.alice.post(`/api/plan/activate/${planId}`, { startDate: '2026-01-05' })).statusCode).toBe(200);
});

afterAll(() => app.close());

describe('plans', () => {
  it('Alice sees her own plan (so the checks below are meaningful)', async () => {
    expect((await users.alice.get(`/api/plan/${planId}`)).statusCode).toBe(200);
    expect((await users.alice.get('/api/plan')).json().map((p: any) => p.id)).toEqual([planId]);
  });

  it("Bob's plan list and schedule don't include it", async () => {
    expect((await users.bob.get('/api/plan')).json()).toEqual([]);
    expect((await users.bob.get('/api/plan/active')).json().activePlans).toEqual([]);
    expect((await users.bob.get('/api/schedule')).json().schedules).toEqual([]);
  });

  it('Bob cannot read, export, change or delete it', async () => {
    const plan = planRow();
    const workouts = workoutRows();

    const attempts = {
      read: () => users.bob.get(`/api/plan/${planId}`),
      export: () => users.bob.get(`/api/plan/export?ids=${planId}`),
      edit: () => users.bob.put(`/api/plan/${planId}`, { name: 'Mine now', days: [{ name: 'x', videoIds: ['alice-video'] }] }),
      favourite: () => users.bob.put(`/api/plan/${planId}/favorite`, { favorite: true }),
      blur: () => users.bob.put(`/api/plan/${planId}/background-blur`, { blur: true }),
      activate: () => users.bob.post(`/api/plan/activate/${planId}`, { slot: 'main' }),
      deactivate: () => users.bob.post(`/api/plan/deactivate/${planId}`),
      duplicate: () => users.bob.post(`/api/plan/${planId}/duplicate`),
      delete: () => users.bob.delete(`/api/plan/${planId}`),
    };
    for (const [label, attempt] of Object.entries(attempts)) {
      expect((await attempt()).statusCode, label).toBe(404);
    }

    expect(planRow()).toEqual(plan);
    expect(workoutRows()).toEqual(workouts);
    expect((await users.bob.get('/api/plan')).json()).toEqual([]);
  });

  it("Bob cannot tick off Alice's workouts", async () => {
    const [workout] = workoutRows() as { id: string }[];
    const res = await users.bob.post('/api/schedule/toggle-done', { workoutId: workout.id });
    expect(res.statusCode).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM history').get()).toEqual({ n: 0 });
  });
});

describe('library', () => {
  it("Bob's library doesn't list Alice's video", async () => {
    expect((await users.alice.get('/api/library/videos')).json().map((v: any) => v.id)).toEqual(['alice-video']);
    expect((await users.bob.get('/api/library/videos')).json()).toEqual([]);
  });

  it("Bob cannot retag or star Alice's video", async () => {
    const video = videoRow();
    const library = libraryRows();

    const retag = await users.bob.patch('/api/library/videos/alice-video', { equipment: ['dumbbells'], description: 'mine' });
    const star = await users.bob.put('/api/library/videos/alice-video/favorite', { favorite: true });

    expect(retag.statusCode).toBe(404);
    expect(star.statusCode).toBe(404);
    expect(videoRow()).toEqual(video);
    expect(libraryRows()).toEqual(library);
  });
});

it('a device that has not picked a profile gets nothing once there are two', async () => {
  const anonymous = as(app);
  for (const url of ['/api/plan', '/api/library/videos', '/api/schedule', `/api/plan/${planId}`]) {
    const res = await anonymous.get(url);
    expect(res.statusCode, url).toBe(401);
    expect(res.json().error).toBe('profile_required');
  }
});

describe('guide banner', () => {
  it("closing it is Alice's choice alone", async () => {
    expect((await users.alice.get('/api/settings')).json().guide_dismissed).toBe(false);
    expect((await users.alice.post('/api/settings', { guide_dismissed: true })).statusCode).toBe(200);

    expect((await users.alice.get('/api/settings')).json().guide_dismissed).toBe(true);
    expect((await users.bob.get('/api/settings')).json().guide_dismissed).toBe(false);
  });
});
