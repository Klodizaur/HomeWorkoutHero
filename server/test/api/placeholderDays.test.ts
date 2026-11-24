import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { rematchPlanWorkouts } from '../../src/matcher.js';
import { as, buildTestApp, seedVideo } from '../helpers.js';

/**
 * Placeholder days: a day in a hand-built plan that has only text ("Swimming",
 * "Add videos later") and no videos yet. It keeps its place in the plan, shows
 * on the calendar as text, can be marked done, and is never matched to videos.
 */

let app: FastifyInstance;
let api: ReturnType<typeof as>;
let planId: string;

beforeAll(async () => {
  app = await buildTestApp();
  api = as(app);
  seedVideo({ id: 'v1', filename: 'Leg day.mp4' });
  // A video whose name a careless matcher might bind to the placeholder.
  seedVideo({ id: 'swim', filename: 'Swimming.mp4' });
  const created = await api.post('/api/plan/create', {
    name: 'With a gap', startDate: '2026-01-05', workoutPattern: [1],
    days: [
      { name: 'Leg day', videoIds: ['v1'] },
      { name: '  Swimming  ', videoIds: [], placeholder: true },
      { name: '   ', videoIds: [], placeholder: true }, // no text: dropped
      { name: 'empty', videoIds: [] },                   // no videos, not a placeholder: dropped
    ],
  });
  expect(created.statusCode).toBe(200);
  planId = created.json().planId;
});

afterAll(() => app.close());

describe('placeholder days', () => {
  it('are kept, in order, with their text; empty days are not', async () => {
    const { days } = (await api.get(`/api/plan/${planId}`)).json();
    expect(days.map((d: any) => [d.name, d.placeholder, d.videos.length])).toEqual([
      ['Leg day', false, 1],
      ['Swimming', true, 0],
    ]);
  });

  it('land on the calendar as text-only days and can be marked done', async () => {
    await api.post(`/api/plan/activate/${planId}`, { startDate: '2026-01-05' });
    const { schedule } = (await api.get('/api/schedule')).json();
    const day = (schedule as any[]).find(d => d.workout?.placeholder);
    expect(day.workout).toMatchObject({ name: 'Swimming', placeholder: true, totalVideosCount: 0, isCompleted: false });

    await api.post('/api/schedule/toggle-done', { workoutId: day.workout.id });
    const after = (await api.get('/api/schedule')).json().schedule.find((d: any) => d.workout?.id === day.workout.id);
    expect(after.workout.isCompleted).toBe(true);
  });

  it('are never matched to a video by name', () => {
    rematchPlanWorkouts(planId);
    const row = db.prepare("SELECT video_ids FROM workouts WHERE plan_id = ? AND placeholder = 1").get(planId) as { video_ids: string };
    expect(JSON.parse(row.video_ids)).toEqual([]);
  });

  it('survive editing, and turn into a normal day once videos are added', async () => {
    const { days } = (await api.get(`/api/plan/${planId}`)).json();
    const edited = await api.put(`/api/plan/${planId}`, {
      name: 'With a gap', startDate: '2026-01-05',
      days: [
        { name: 'Leg day', videoIds: ['v1'], workoutId: days[0].id },
        { name: 'Swimming', videoIds: ['swim'], workoutId: days[1].id },
      ],
    });
    expect(edited.statusCode).toBe(200);
    const after = (await api.get(`/api/plan/${planId}`)).json().days;
    expect(after[1]).toMatchObject({ placeholder: false });
    expect(after[1].videos.map((v: any) => v.id)).toEqual(['swim']);
  });

  it('travel in an exported plan file', async () => {
    const created = await api.post('/api/plan/create', {
      name: 'Export me', days: [{ name: 'Walk outside', videoIds: [], placeholder: true }, { name: 'x', videoIds: ['v1'] }],
    });
    const file = (await api.get(`/api/plan/export?ids=${created.json().planId}`)).json();
    expect(file.plans[0].workouts[0]).toMatchObject({ name: 'Walk outside', placeholder: true, videos: [] });

    const imported = await api.post('/api/plan/import', { file });
    expect(imported.statusCode).toBe(200);
    const newId = imported.json().planIds[0];
    const { days } = (await api.get(`/api/plan/${newId}`)).json();
    expect(days[0]).toMatchObject({ name: 'Walk outside', placeholder: true });
  });

  it('keep an optional length, which the log counts once the day is marked done', async () => {
    const created = await api.post('/api/plan/create', {
      name: 'Timed', startDate: '2026-02-02', workoutPattern: [1],
      days: [
        { name: 'Swim', videoIds: [], placeholder: true, minutes: 45 },
        { name: 'Walk', videoIds: [], placeholder: true, minutes: 'abc' }, // nonsense: no length
        { name: 'Long hike', videoIds: [], placeholder: true, minutes: 9000 }, // capped at 10 h
      ],
    });
    const id = created.json().planId;
    const { days } = (await api.get(`/api/plan/${id}`)).json();
    expect(days.map((d: any) => d.minutes)).toEqual([45, null, 600]);

    await api.post(`/api/plan/activate/${id}`, { startDate: '2026-02-02', slot: 'extra' });
    const plan = (await api.get('/api/schedule')).json().schedules.find((p: any) => p.planId === id);
    const swim = plan.schedule.find((d: any) => d.workout?.name === 'Swim').workout;
    expect(swim.minutes).toBe(45);

    await api.post('/api/schedule/toggle-done', { workoutId: swim.id });
    const entry = (await api.get('/api/profile/history')).json().entries.find((e: any) => e.workoutId === swim.id);
    expect(entry.durationSeconds).toBe(45 * 60);

    // Editing keeps it, and a changed length is saved.
    await api.put(`/api/plan/${id}`, {
      name: 'Timed', startDate: '2026-02-02',
      days: days.map((d: any, i: number) => ({ name: d.name, videoIds: [], placeholder: true, workoutId: d.id, minutes: i === 0 ? 30 : null })),
    });
    expect((await api.get(`/api/plan/${id}`)).json().days.map((d: any) => d.minutes)).toEqual([30, null, null]);

    // And it travels in an exported file.
    const file = (await api.get(`/api/plan/export?ids=${id}`)).json();
    expect(file.plans[0].workouts[0]).toMatchObject({ name: 'Swim', minutes: 30 });
    const imported = await api.post('/api/plan/import', { file });
    const copy = (await api.get(`/api/plan/${imported.json().planIds[0]}`)).json();
    expect(copy.days[0]).toMatchObject({ name: 'Swim', minutes: 30 });
  });

  it('can be an activity of its own instead of a placeholder, and keep that everywhere', async () => {
    const created = await api.post('/api/plan/create', {
      name: 'Mixed', startDate: '2026-03-02', workoutPattern: [1],
      days: [
        { name: 'Swimming', videoIds: [], placeholder: true, kind: 'activity', minutes: 40 },
        { name: 'Videos later', videoIds: [], placeholder: true },
        { name: 'Odd', videoIds: [], placeholder: true, kind: 'banana' }, // unknown: a placeholder
      ],
    });
    const id = created.json().planId;
    const { days, workouts } = (await api.get(`/api/plan/${id}`)).json();
    expect(days.map((d: any) => d.kind)).toEqual(['activity', 'placeholder', 'placeholder']);
    expect(workouts.map((w: any) => w.placeholder_kind)).toEqual(['activity', null, null]);

    await api.post(`/api/plan/activate/${id}`, { startDate: '2026-03-02', slot: 'extra' });
    const plan = (await api.get('/api/schedule')).json().schedules.find((p: any) => p.planId === id);
    expect(plan.schedule.map((d: any) => d.workout?.kind)).toEqual(['activity', 'placeholder', 'placeholder']);

    // Turning it back into a placeholder in the editor.
    await api.put(`/api/plan/${id}`, {
      name: 'Mixed', startDate: '2026-03-02',
      days: days.map((d: any) => ({ name: d.name, videoIds: [], placeholder: true, workoutId: d.id })),
    });
    expect((await api.get(`/api/plan/${id}`)).json().days[0].kind).toBe('placeholder');

    // An activity survives a copy and an exported file.
    await api.put(`/api/plan/${id}`, {
      name: 'Mixed', startDate: '2026-03-02',
      days: [{ name: 'Swimming', videoIds: [], placeholder: true, kind: 'activity', workoutId: days[0].id }],
    });
    const copy = (await api.post(`/api/plan/${id}/duplicate`, {})).json();
    const copyId = copy.planId ?? copy.id;
    expect((await api.get(`/api/plan/${copyId}`)).json().days[0].kind).toBe('activity');

    const file = (await api.get(`/api/plan/export?ids=${id}`)).json();
    expect(file.plans[0].workouts[0]).toMatchObject({ name: 'Swimming', kind: 'activity' });
    const imported = await api.post('/api/plan/import', { file });
    expect((await api.get(`/api/plan/${imported.json().planIds[0]}`)).json().days[0].kind).toBe('activity');
  });
});
