import { describe, it, expect } from 'vitest';
import { resamplePath, elevationGain, fixFirstSplitElevation, MAX_MISSING_FRACTION } from './elevation.js';

describe('resamplePath', () => {
  it('keeps first and last points', () => {
    const pts: [number, number][] = [[59.0, 18.0], [59.001, 18.0], [59.002, 18.0]];
    const out = resamplePath(pts, 50);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('drops points closer together than the spacing', () => {
    // ~1.1m apart at this latitude
    const pts: [number, number][] = Array.from({ length: 20 }, (_, i) => [59 + i * 0.00001, 18] as [number, number]);
    expect(resamplePath(pts, 50)).toHaveLength(2); // first + last only
  });

  it('returns the input unchanged when under two points', () => {
    expect(resamplePath([], 50)).toEqual([]);
    expect(resamplePath([[59, 18]], 50)).toEqual([[59, 18]]);
  });
});

describe('elevationGain', () => {
  it('sums only positive climbs', () => {
    expect(elevationGain([0, 10, 5, 15], 0)).toBe(20);
  });

  it('ignores wiggles below the hysteresis threshold', () => {
    // 1m jitter around a flat line should yield no gain at 3m threshold
    expect(elevationGain([10, 11, 10, 11, 10, 11], 3)).toBe(0);
  });

  it('counts a sustained climb even when delivered in small steps', () => {
    expect(elevationGain([0, 1, 2, 3, 4, 5, 6], 3)).toBe(6);
  });

  it('does not double-count a descent', () => {
    expect(elevationGain([0, 20, 0], 3)).toBe(20);
  });

  it('returns 0 for short input', () => {
    expect(elevationGain([], 3)).toBe(0);
    expect(elevationGain([5], 3)).toBe(0);
  });
});

describe('fixFirstSplitElevation', () => {
  it('zeroes a first split whose value is an absolute altitude', () => {
    const splits = [
      { split: 1, elevation_difference: 37.1 },
      { split: 2, elevation_difference: -8.1 },
    ];
    expect(fixFirstSplitElevation(splits)[0].elevation_difference).toBe(0);
  });

  it('leaves later splits untouched', () => {
    const splits = [
      { split: 1, elevation_difference: 31 },
      { split: 2, elevation_difference: -2 },
      { split: 3, elevation_difference: 10 },
    ];
    const out = fixFirstSplitElevation(splits);
    expect(out[1].elevation_difference).toBe(-2);
    expect(out[2].elevation_difference).toBe(10);
  });

  it('handles an empty split list', () => {
    expect(fixFirstSplitElevation([])).toEqual([]);
  });
});

describe('DEM void handling', () => {
  it('caps how much of a route may be unresolved', () => {
    expect(MAX_MISSING_FRACTION).toBeGreaterThan(0);
    expect(MAX_MISSING_FRACTION).toBeLessThan(1);
  });

  it('does not treat an unresolved point as sea level', () => {
    // A real profile sitting around 20-30m. If a void were coerced to 0,
    // the gain would balloon past 40m instead of staying near the true ~10m.
    const realistic = [20, 22, 25, 28, 30, 28, 25, 22, 20];
    const withVoidAsZero = [20, 22, 0, 28, 30, 0, 25, 22, 20];
    expect(elevationGain(realistic, 3)).toBeLessThan(15);
    expect(elevationGain(withVoidAsZero, 3)).toBeGreaterThan(40);
  });
});
