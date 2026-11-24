import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, seedVideo, twoProfiles } from '../helpers.js';

/**
 * How the user felt before and after a workout: stored on the log, per
 * workout and day, read back with the history, and private to the profile.
 */

let app: FastifyInstance;
let alice: Awaited<ReturnType<typeof twoProfiles>>['alice'];
let bob: Awaited<ReturnType<typeof twoProfiles>>['bob'];

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
};

beforeAll(async () => {
  app = await buildTestApp();
  ({ alice, bob } = await twoProfiles(app));
  seedVideo({ id: 'v1', filename: 'Warm up.mp4' });
  seedVideo({ id: 'v2', filename: 'Main set.mp4' });
});

afterAll(() => app.close());

async function history(api: typeof alice) {
  return (await api.get('/api/profile/history')).json().entries as any[];
}

describe('mood', () => {
  it('is stored with a manual entry and read back', async () => {
    const res = await alice.post('/api/profile/history', {
      completedDate: '2026-01-10', workoutName: 'Run', moodBefore: 2, moodAfter: 4,
    });
    expect(res.statusCode).toBe(200);
    const entry = (await history(alice)).find(e => e.workoutName === 'Run');
    expect(entry).toMatchObject({ moodBefore: 2, moodAfter: 4 });
  });

  it('defaults to none, and ignores values off the scale on create', async () => {
    await alice.post('/api/profile/history', { completedDate: '2026-01-11', workoutName: 'Walk', moodAfter: 9 });
    const entry = (await history(alice)).find(e => e.workoutName === 'Walk');
    expect(entry).toMatchObject({ moodBefore: null, moodAfter: null });
  });

  it('can be changed by entry id, one side at a time, and cleared', async () => {
    const entry = (await history(alice)).find(e => e.workoutName === 'Run');

    expect((await alice.put('/api/profile/history/mood', { ids: [entry.id], moodAfter: 5 })).statusCode).toBe(200);
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodBefore: 2, moodAfter: 5 });

    await alice.put('/api/profile/history/mood', { ids: [entry.id], moodBefore: null });
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodBefore: null, moodAfter: 5 });
  });

  it('rejects a mood off the scale or a request with nothing to change', async () => {
    const entry = (await history(alice)).find(e => e.workoutName === 'Run');
    expect((await alice.put('/api/profile/history/mood', { ids: [entry.id], moodAfter: 0 })).statusCode).toBe(400);
    expect((await alice.put('/api/profile/history/mood', { ids: [entry.id], moodAfter: 2.5 })).statusCode).toBe(400);
    expect((await alice.put('/api/profile/history/mood', { ids: [entry.id] })).statusCode).toBe(400);
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodAfter: 5 });
  });

  it("is saved for a plan workout's whole session, and carries to parts marked afterwards", async () => {
    const { planId } = (await alice.post('/api/plan/create', {
      name: 'Mood plan', startDate: today(), days: [{ name: 'Day 1', videoIds: ['v1', 'v2'] }],
    })).json();
    expect((await alice.post(`/api/plan/activate/${planId}`, { startDate: today() })).statusCode).toBe(200);
    const { schedule } = (await alice.get('/api/schedule')).json();
    const workoutId = (schedule as any[]).find(d => d.isWorkoutDay).workout.id as string;

    await alice.post('/api/schedule/toggle-done', { workoutId, videoId: 'v1' });
    const saved = await alice.put('/api/profile/history/mood', { workoutId, moodBefore: 3, moodAfter: 4 });
    expect(saved.json().updated).toBe(1);

    // The second part, marked after the mood was given, joins it.
    await alice.post('/api/schedule/toggle-done', { workoutId, videoId: 'v2' });
    const parts = (await history(alice)).filter(e => e.workoutId === workoutId);
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(p).toMatchObject({ moodBefore: 3, moodAfter: 4 });
  });

  it('stores why a workout felt rough, and refuses a reason it does not know', async () => {
    const entry = (await history(alice)).find(e => e.workoutName === 'Run');
    const res = await alice.put('/api/profile/history/mood', { ids: [entry.id], moodReason: 'exhausting' });
    expect(res.json().updated).toBe(1);
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodReason: 'exhausting' });

    expect((await alice.put('/api/profile/history/mood', { ids: [entry.id], moodReason: 'because' })).statusCode).toBe(400);
    await alice.put('/api/profile/history/mood', { ids: [entry.id], moodReason: null });
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodReason: null });
  });

  it("can't be read or changed by another profile", async () => {
    const entry = (await history(alice)).find(e => e.workoutName === 'Run');
    expect((await history(bob)).some(e => e.id === entry.id)).toBe(false);

    const res = await bob.put('/api/profile/history/mood', { ids: [entry.id], moodAfter: 1 });
    expect(res.json().updated).toBe(0);
    expect((await history(alice)).find(e => e.id === entry.id)).toMatchObject({ moodAfter: 5 });
  });

  it('can be switched off per profile, which keeps the moods already logged', async () => {
    expect((await alice.get('/api/settings')).json().mood_tracking).toBe(true);

    await alice.post('/api/settings', { mood_tracking: false });
    expect((await alice.get('/api/settings')).json().mood_tracking).toBe(false);
    expect((await bob.get('/api/settings')).json().mood_tracking).toBe(true);
    expect((await history(alice)).find(e => e.workoutName === 'Run')).toMatchObject({ moodAfter: 5 });

    await alice.post('/api/settings', { mood_tracking: true });
    expect((await alice.get('/api/settings')).json().mood_tracking).toBe(true);
  });
});
