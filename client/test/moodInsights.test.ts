import { describe, expect, it } from 'vitest';
import { isRoughMood, MoodEntry, moodHints, moodSummary, groupWorkouts } from '../src/lib/moodInsights';

let n = 0;
const entry = (over: Partial<MoodEntry>): MoodEntry => ({
  id: `e${++n}`,
  workoutId: null,
  workoutName: `W${n}`,
  completedDate: '2026-11-01',
  moodBefore: null,
  moodAfter: null,
  moodReason: null,
  durationSeconds: 600,
  trainingType: [],
  equipment: [],
  intensity: null,
  ...over,
});

describe('mood summary', () => {
  it('counts a workout once, and only with both moods; any rise is better', () => {
    const s = moodSummary([
      // One workout logged as two videos.
      entry({ workoutId: 'w1', moodBefore: 2, moodAfter: 3 }),
      entry({ workoutId: 'w1', moodBefore: 2, moodAfter: 3 }),
      entry({ moodBefore: 4, moodAfter: 5 }),
      entry({ moodBefore: 3, moodAfter: 3 }),
      entry({ moodBefore: 4, moodAfter: 2 }),
      entry({ moodAfter: 5 }), // no before: not counted
    ]);
    expect(s).toMatchObject({ counted: 4, better: 2, same: 1, worse: 1 });
  });

  it('names what lifts the mood by how often it helped, not how often it was done', () => {
    const entries = [
      // Strength: done 5 times, better 3 of them.
      ...[1, 2, 3, 4, 5].map(i => entry({ moodBefore: 3, moodAfter: i <= 3 ? 4 : 3, trainingType: ['Strength'], equipment: ['dumbbells'] })),
      // Dance: done 3 times, better every time.
      ...[1, 2, 3].map(() => entry({ moodBefore: 2, moodAfter: 4, trainingType: ['Dance'], equipment: ['no_equipment'] })),
      // Yoga: better twice, but only 2 workouts — not enough to call it.
      ...[1, 2].map(() => entry({ moodBefore: 2, moodAfter: 5, trainingType: ['Yoga'] })),
    ];
    const s = moodSummary(entries);
    expect(s.bestTypes.map(r => r.key)).toEqual(['Dance', 'Strength']);
    expect(s.bestTypes[0]).toMatchObject({ better: 3, total: 3 });
    expect(s.bestEquipment.map(r => r.key)).toEqual(['no_equipment', 'dumbbells']);
  });

  it("doesn't call something best when it helped less than half the time", () => {
    const entries = [1, 2, 3, 4, 5].map(i => entry({ moodBefore: 3, moodAfter: i === 1 ? 4 : 3, trainingType: ['Walking'] }));
    expect(moodSummary(entries).bestTypes).toEqual([]);
  });

  it('says nothing about patterns with fewer than five workouts', () => {
    const s = moodSummary([1, 2, 3, 4].map(() => entry({ moodBefore: 1, moodAfter: 5, trainingType: ['Dance'] })));
    expect(s.bestTypes).toEqual([]);
  });

  it('tallies the reasons given', () => {
    const s = moodSummary([
      entry({ moodAfter: 2, moodReason: 'exhausting' }),
      entry({ moodAfter: 1, moodReason: 'exhausting' }),
      entry({ moodAfter: 2, moodReason: 'too_long' }),
    ]);
    expect(s.reasons).toEqual([{ reason: 'exhausting', count: 2 }, { reason: 'too_long', count: 1 }]);
  });
});

describe('rough mood', () => {
  it('is a low after-mood, or one lower than before', () => {
    expect(isRoughMood(null, 2)).toBe(true);
    expect(isRoughMood(5, 4)).toBe(true);
    expect(isRoughMood(3, 3)).toBe(false);
    expect(isRoughMood(2, 3)).toBe(false);
    expect(isRoughMood(4, null)).toBe(false);
  });
});

describe('hints', () => {
  const workout = (over: Partial<MoodEntry>) => groupWorkouts([entry(over)])[0];

  it('suggests lighter weights and an easier pace for an exhausting dumbbell HIIT', () => {
    const keys = moodHints('exhausting', workout({ equipment: ['dumbbells'], trainingType: ['HIIT'] }), []).map(h => h.key);
    expect(keys).toEqual(['lighter_weights', 'lower_intensity', 'breaks', 'experienced']);
  });

  it('keeps it to pacing for an exhausting workout without weights', () => {
    const keys = moodHints('exhausting', workout({ trainingType: ['Pilates'], intensity: 'medium' }), []).map(h => h.key);
    expect(keys).toEqual(['breaks', 'experienced']);
  });

  it('points a bored user at a type that has lifted their mood before', () => {
    const history = [1, 2, 3, 4, 5].map(() => entry({ moodBefore: 2, moodAfter: 4, trainingType: ['Dance'] }));
    const hints = moodHints('too_easy', workout({ trainingType: ['Walking'] }), history);
    expect(hints[0]).toEqual({ key: 'best_type', values: { type: 'Dance', better: 5, total: 5 } });
  });

  it('never tells someone in pain to push on', () => {
    expect(moodHints('pain', workout({}), []).map(h => h.key)).toEqual(['pain', 'low_impact']);
  });
});
