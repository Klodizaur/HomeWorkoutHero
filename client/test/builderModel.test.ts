import { describe, expect, it } from 'vitest';
import {
  createWeek, groupBySlots, isWeeklyPattern, relayoutWeeks, splitWeeks, toWeeklyPattern, workoutSlots,
  type BuilderWeek,
} from '../src/lib/builderModel';

const WEEK_BY_WEEK = [1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]; // three, then two

describe('week-by-week rhythms', () => {
  it('recognises a cycle of whole weeks that each have a workout', () => {
    expect(isWeeklyPattern(WEEK_BY_WEEK)).toBe(true);
    expect(isWeeklyPattern([1, 1, 1, 1, 1, 0, 0])).toBe(false); // one week is a plain cycle
    expect(isWeeklyPattern([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(false); // an empty week
    expect(isWeeklyPattern([1, 0, 1, 0, 1, 0, 1, 0, 1, 0])).toBe(false); // not whole weeks
  });

  it('splits a cycle into seven-day weeks', () => {
    expect(splitWeeks([1, 0, 1, 0, 1, 0, 1, 0, 1, 0])).toEqual([[1, 0, 1, 0, 1, 0, 1], [0, 1, 0]]);
  });

  it('turns any cycle into whole weeks, each with a workout day', () => {
    expect(toWeeklyPattern([1, 0, 1])).toEqual([1, 0, 1, 0, 0, 0, 0]);
    expect(toWeeklyPattern([0, 0, 0, 0, 0, 0, 0, 1, 0, 1])).toEqual([1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0]);
    expect(toWeeklyPattern(Array(100).fill(1))).toHaveLength(12 * 7);
  });

  it('counts workout slots, never fewer than one', () => {
    expect(workoutSlots([1, 0, 1])).toBe(2);
    expect(workoutSlots([0, 0])).toBe(1);
  });

  it('groups workouts into weeks following the rhythm', () => {
    expect(groupBySlots(7, WEEK_BY_WEEK)).toEqual([
      { start: 0, size: 3 }, { start: 3, size: 2 }, { start: 5, size: 3 },
    ]);
    expect(groupBySlots(5, [1, 1, 0])).toEqual([
      { start: 0, size: 2 }, { start: 2, size: 2 }, { start: 4, size: 2 },
    ]);
    expect(groupBySlots(0, [1])).toEqual([]);
  });
});

describe('relayoutWeeks', () => {
  const day = (id: string) => ({ name: id, videoIds: [id] });
  const weeks: BuilderWeek[] = [
    { name: 'Week 1', days: [day('a'), { name: 'empty', videoIds: [] }, day('b')] },
    { name: 'Week 2', days: [day('c'), day('d')] },
  ];
  const ids = (out: BuilderWeek[]) => out.map(week => week.days.map(d => d.videoIds[0] ?? '-'));

  it('re-deals filled days in order, dropping empty ones and padding the last week', () => {
    expect(ids(relayoutWeeks(weeks, 3))).toEqual([['a', 'b', 'c'], ['d', '-', '-']]);
  });

  it('follows a different size per week', () => {
    expect(ids(relayoutWeeks(weeks, week => (week === 0 ? 1 : 2)))).toEqual([['a'], ['b', 'c'], ['d', '-']]);
  });

  it('always leaves at least one week', () => {
    expect(relayoutWeeks([], 2)).toEqual([createWeek(1, 2)]);
  });
});
