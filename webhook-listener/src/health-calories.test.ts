import { describe, it, expect } from 'vitest';
import { matchWorkout } from './health-calories.js';

const W = (start_time: string, calories_kcal: number | null) => ({ start_time, calories_kcal });

describe('matchWorkout', () => {
  it('pairs a run with the workout that started seconds apart', () => {
    const w = matchWorkout('2026-09-29T15:32:45.607Z', [
      W('2026-09-29T18:24:58Z', 189),
      W('2026-09-29T15:32:42Z', 1025),
    ]);
    expect(w?.calories_kcal).toBe(1025);
  });

  it('picks the closest when two are within tolerance', () => {
    const w = matchWorkout('2026-09-29T15:32:45Z', [
      W('2026-09-29T15:31:30Z', 1),
      W('2026-09-29T15:33:00Z', 2),
    ]);
    expect(w?.calories_kcal).toBe(2);
  });

  it('ignores workouts outside two minutes', () => {
    expect(matchWorkout('2026-09-29T15:32:45Z', [W('2026-09-29T15:35:00Z', 900)])).toBeNull();
  });

  it('ignores workouts without a calorie figure', () => {
    expect(matchWorkout('2026-09-29T15:32:45Z', [W('2026-09-29T15:32:42Z', null)])).toBeNull();
    expect(matchWorkout('2026-09-29T15:32:45Z', [W('2026-09-29T15:32:42Z', 0)])).toBeNull();
  });
});
