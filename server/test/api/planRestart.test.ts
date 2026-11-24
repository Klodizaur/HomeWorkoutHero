import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { as, buildTestApp, seedVideo } from '../helpers.js';

/**
 * Starting a plan you've already finished is doing it again: every day opens up,
 * while the finish and what you logged the first time stay as they were.
 */

let app: FastifyInstance;
let api: ReturnType<typeof as>;

beforeAll(async () => {
  app = await buildTestApp();
  api = as(app);
  seedVideo({ id: 'a', filename: 'Yoga.mp4' });
  seedVideo({ id: 'b', filename: 'Stretch.mp4' });
});

afterAll(() => app.close());

const newPlan = async (name: string) => {
  const res = await api.post('/api/plan/create', {
    name, startDate: '2026-01-05', workoutPattern: [1],
    days: [{ name: 'D1', videoIds: ['a'] }, { name: 'D2', videoIds: ['b'] }],
  });
  return res.json().planId as string;
};
const planDays = async (id: string) =>
  (await api.get('/api/schedule')).json().schedules.find((s: any) => s.planId === id).schedule
    .filter((d: any) => d.workout).map((d: any) => d.workout);
const log = async () => (await api.get('/api/profile/history')).json().entries as any[];
const finishes = async (id: string) =>
  (await api.get('/api/plan')).json().find((p: any) => p.id === id).completion_count;

describe('starting a finished plan again', () => {
  it('opens every day, keeps the finish, and leaves the first run in the log', async () => {
    const id = await newPlan('Body & Mind');
    await api.post(`/api/plan/activate/${id}`, { startDate: '2026-01-05', slot: 'extra' });
    const [d1, d2] = await planDays(id);
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    await api.post('/api/schedule/toggle-done', { workoutId: d2.id, videoId: 'b' });
    const first = (await log()).find(e => e.workoutId === d1.id);
    await api.put('/api/profile/history/mood', { ids: [first.id], moodBefore: 2, moodAfter: 5 });
    expect(await finishes(id)).toBe(1);
    // Runs are told apart by time (to the second); in the app a restart comes
    // days later, here it's the same second, so date the first finish back.
    db.prepare("UPDATE plan_completions SET finished_at = datetime('now', '-1 day') WHERE plan_id = ?").run(id);

    await api.post(`/api/plan/deactivate/${id}`);
    const res = await api.post(`/api/plan/activate/${id}`, { startDate: '2026-02-02', slot: 'extra' });
    expect(res.json().restarted).toBe(true);

    expect((await planDays(id)).map((w: any) => w.isCompleted)).toEqual([false, false]);
    expect(await finishes(id)).toBe(1);
    let entries = await log();
    expect(entries.filter(e => e.planName === 'Body & Mind')).toHaveLength(2);

    // Doing day 1 again adds an entry; the first one, mood and all, is still there.
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    entries = (await log()).filter(e => e.planName === 'Body & Mind');
    expect(entries).toHaveLength(3);
    expect(entries.filter(e => e.moodAfter === 5)).toHaveLength(1);
    const again = entries.find(e => e.workoutId === d1.id);
    expect(again.moodAfter).toBeNull();

    // Un-ticking it again only takes back the new entry.
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    expect((await log()).filter(e => e.planName === 'Body & Mind')).toHaveLength(2);

    // Finishing the second run counts as a second finish.
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    await api.post('/api/schedule/toggle-done', { workoutId: d2.id, videoId: 'b' });
    expect(await finishes(id)).toBe(2);
  });

  it('keeps the ticks of a plan that was only paused part-way', async () => {
    const id = await newPlan('Half done');
    await api.post(`/api/plan/activate/${id}`, { startDate: '2026-01-05', slot: 'extra' });
    const [d1] = await planDays(id);
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    await api.post(`/api/plan/deactivate/${id}`);

    const res = await api.post(`/api/plan/activate/${id}`, { startDate: '2026-02-02', slot: 'extra' });
    expect(res.json().restarted).toBe(false);
    expect((await planDays(id)).map((w: any) => w.isCompleted)).toEqual([true, false]);
  });

  it("doesn't reset a finished plan that's still running when it's moved or re-dated", async () => {
    const id = await newPlan('Still on');
    await api.post(`/api/plan/activate/${id}`, { startDate: '2026-01-05', slot: 'extra' });
    const [d1, d2] = await planDays(id);
    await api.post('/api/schedule/toggle-done', { workoutId: d1.id, videoId: 'a' });
    await api.post('/api/schedule/toggle-done', { workoutId: d2.id, videoId: 'b' });

    const res = await api.post(`/api/plan/activate/${id}`, { startDate: '2026-01-12', slot: 'main' });
    expect(res.json().restarted).toBe(false);
    expect((await planDays(id)).map((w: any) => w.isCompleted)).toEqual([true, true]);
  });
});
