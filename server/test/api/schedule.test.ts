import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { setProfileSetting } from '../../src/profiles.js';
import { as, buildTestApp } from '../helpers.js';

/**
 * How a plan's workouts land on the calendar: its rhythm (plain or week by
 * week), the profile's rhythm when it has none, frozen days, and the dates
 * themselves across daylight-saving changes.
 */

let app: FastifyInstance;
let api: ReturnType<typeof as>;

beforeAll(async () => {
  app = await buildTestApp();
  api = as(app);
});

afterAll(() => app.close());

/** Create a plan with `count` workouts and make it the active one, from 5 Jan 2026 (a Monday) unless told otherwise. */
async function activePlan(count: number, workoutPattern?: number[], startDate = '2026-01-05'): Promise<string> {
  const created = await api.post('/api/plan/create', {
    name: 'Rhythm', startDate, workoutPattern,
    days: Array.from({ length: count }, (_, i) => ({ name: `W${i + 1}`, videoIds: ['v'] })),
  });
  const { planId } = created.json();
  expect((await api.post(`/api/plan/activate/${planId}`, { startDate })).statusCode).toBe(200);
  return planId;
}

async function workoutDays() {
  const { schedule } = (await api.get('/api/schedule')).json();
  return (schedule as any[]).filter(day => day.isWorkoutDay).map(day => `${day.date} ${day.workout.name}`);
}

describe('schedule', () => {
  it("follows the plan's own rhythm", async () => {
    await activePlan(3, [1, 0]);
    expect(await workoutDays()).toEqual(['2026-01-05 W1', '2026-01-07 W2', '2026-01-09 W3']);
  });

  it('follows a week-by-week rhythm, then repeats it', async () => {
    // Week 1: Mon–Wed. Week 2: Mon, Wed, Fri.
    await activePlan(7, [1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(await workoutDays()).toEqual([
      '2026-01-05 W1', '2026-01-06 W2', '2026-01-07 W3',
      '2026-01-12 W4', '2026-01-14 W5', '2026-01-16 W6',
      '2026-01-19 W7',
    ]);
  });

  it("uses the profile's rhythm when the plan has none", async () => {
    setProfileSetting('p1', 'workout_pattern', '[1,0,0]');
    await activePlan(3);
    expect(await workoutDays()).toEqual(['2026-01-05 W1', '2026-01-08 W2', '2026-01-11 W3']);
  });

  it('falls back to five on, one off when a rhythm has no workout days', async () => {
    const planId = await activePlan(6, [1]);
    db.prepare("UPDATE workout_plans SET workout_pattern = '[0,0]' WHERE id = ?").run(planId);
    expect(await workoutDays()).toEqual([
      '2026-01-05 W1', '2026-01-06 W2', '2026-01-07 W3', '2026-01-08 W4', '2026-01-09 W5', '2026-01-11 W6',
    ]);
  });

  it('a frozen day pushes the rest of the plan back', async () => {
    const planId = await activePlan(3, [1]);
    db.prepare("INSERT INTO plan_freezes (id, plan_id, date, reason) VALUES ('f1', ?, '2026-01-06', 'unwell')").run(planId);

    const { schedule } = (await api.get('/api/schedule')).json();
    expect(schedule.map((day: any) => [day.date, day.workout?.name ?? null, day.frozen])).toEqual([
      ['2026-01-05', 'W1', null],
      ['2026-01-06', null, 'unwell'],
      ['2026-01-07', 'W2', null],
      ['2026-01-08', 'W3', null],
    ]);
  });
});

describe('schedule across daylight-saving changes', () => {
  // The server runs on the user's own computer, so its timezone is theirs.
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  /** The date `n` days after 1 Mar 2026, worked out without any timezone. */
  const day = (n: number) => new Date(Date.UTC(2026, 2, 1 + n)).toISOString().slice(0, 10);

  // East of UTC (Europe springs forward on 29 Mar and falls back on 25 Oct) and
  // west of it (the US changes on 8 Mar and 1 Nov).
  it.each(['Europe/Warsaw', 'Europe/London', 'America/New_York'])(
    'gives every day its own date, all year round (%s)',
    async timezone => {
      process.env.TZ = timezone;
      // Sundays from 1 Mar to 8 Nov 2026: past every change on both sides.
      await activePlan(37, [1, 0, 0, 0, 0, 0, 0], '2026-03-01');

      const { schedule } = (await api.get('/api/schedule')).json();
      expect(schedule.map((d: any) => d.date)).toEqual(Array.from({ length: 36 * 7 + 1 }, (_, n) => day(n)));
      expect(await workoutDays()).toEqual(Array.from({ length: 37 }, (_, i) => `${day(7 * i)} W${i + 1}`));
    }
  );
});
