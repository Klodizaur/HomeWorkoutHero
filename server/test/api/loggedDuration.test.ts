import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { buildTestApp, seedVideo, twoProfiles } from '../helpers.js';

/**
 * A workout logged by hand without a video ("Swimming") has no runtime to read,
 * so its length is typed. It's read back with the history (which the Breakdown
 * totals), can be changed or cleared later, and never touches a video's entry.
 */

let app: FastifyInstance;
let alice: Awaited<ReturnType<typeof twoProfiles>>['alice'];
let bob: Awaited<ReturnType<typeof twoProfiles>>['bob'];

beforeAll(async () => {
  app = await buildTestApp();
  ({ alice, bob } = await twoProfiles(app));
  seedVideo({ id: 'v1', filename: 'Warm up.mp4' });
  db.prepare('UPDATE videos SET duration_seconds = 600 WHERE id = ?').run('v1');
});

afterAll(() => app.close());

const history = async (api: typeof alice) => (await api.get('/api/profile/history')).json().entries as any[];

describe('length of a logged workout without a video', () => {
  it('is saved on the typed entry only; a video keeps its own runtime', async () => {
    const res = await alice.post('/api/profile/history', {
      completedDate: '2026-01-10', workoutName: 'Swimming', videoIds: ['v1'], durationMinutes: 45,
    });
    expect(res.statusCode).toBe(200);
    const rows = await history(alice);
    expect(rows.find(e => e.workoutName === 'Swimming' && !e.videoId).durationSeconds).toBe(45 * 60);
    expect(rows.find(e => e.videoId === 'v1').durationSeconds).toBe(600);
  });

  it('ignores nonsense and caps at ten hours', async () => {
    await alice.post('/api/profile/history', { completedDate: '2026-01-11', workoutName: 'Hike', durationMinutes: 9000 });
    await alice.post('/api/profile/history', { completedDate: '2026-01-12', workoutName: 'Stretch', durationMinutes: 'lots' });
    const rows = await history(alice);
    expect(rows.find(e => e.workoutName === 'Hike').durationSeconds).toBe(600 * 60);
    expect(rows.find(e => e.workoutName === 'Stretch').durationSeconds).toBeNull();
  });

  it('can be added, changed and cleared later, by its owner only', async () => {
    const stretch = (await history(alice)).find(e => e.workoutName === 'Stretch');
    expect((await alice.put('/api/profile/history/duration', { ids: [stretch.id], minutes: 20 })).statusCode).toBe(200);
    expect((await history(alice)).find(e => e.id === stretch.id).durationSeconds).toBe(20 * 60);

    // Someone else's id changes nothing.
    expect((await bob.put('/api/profile/history/duration', { ids: [stretch.id], minutes: 99 })).json().updated).toBe(0);

    expect((await alice.put('/api/profile/history/duration', { ids: [stretch.id], minutes: 'x' })).statusCode).toBe(400);
    await alice.put('/api/profile/history/duration', { ids: [stretch.id], minutes: null });
    expect((await history(alice)).find(e => e.id === stretch.id).durationSeconds).toBeNull();
  });

  it("doesn't overwrite a video entry's runtime", async () => {
    const video = (await history(alice)).find(e => e.videoId === 'v1');
    expect((await alice.put('/api/profile/history/duration', { ids: [video.id], minutes: 5 })).json().updated).toBe(0);
    expect((await history(alice)).find(e => e.id === video.id).durationSeconds).toBe(600);
  });
});
