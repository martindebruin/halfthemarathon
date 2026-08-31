import { describe, it, expect } from 'vitest';
import { computedSpeed, parseSplits } from './utils.js';

describe('computedSpeed', () => {
  it('returns distance_m / moving_time_s', () => {
    // 5000m in 1500s = 3.333... m/s
    expect(computedSpeed(5000, 1500)).toBeCloseTo(3.333, 3);
  });

  it('returns null when distance is null', () => {
    expect(computedSpeed(null, 1500)).toBeNull();
  });

  it('returns null when time is null', () => {
    expect(computedSpeed(5000, null)).toBeNull();
  });

  it('returns null when distance is 0', () => {
    expect(computedSpeed(0, 1500)).toBeNull();
  });

  it('returns null when time is 0', () => {
    expect(computedSpeed(5000, 0)).toBeNull();
  });
});

describe('parseSplits', () => {
  const rows = [
    { split: 1, average_speed: 2.5, moving_time: 400, elevation_difference: 0, distance: 1000 },
  ];

  it('passes through an already-parsed array from Directus', () => {
    expect(parseSplits(rows)).toEqual(rows);
  });

  it('parses a legacy JSON string', () => {
    expect(parseSplits(JSON.stringify(rows))).toEqual(rows);
  });

  it('returns empty for null, undefined and empty string', () => {
    expect(parseSplits(null)).toEqual([]);
    expect(parseSplits(undefined)).toEqual([]);
    expect(parseSplits('')).toEqual([]);
  });

  it('returns empty for malformed JSON rather than throwing', () => {
    expect(parseSplits('{not json')).toEqual([]);
  });

  it('returns empty when the JSON is valid but not an array', () => {
    expect(parseSplits('{"a":1}')).toEqual([]);
  });
});
