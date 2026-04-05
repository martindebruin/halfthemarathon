import { describe, it, expect } from 'vitest';
import { computedSpeed } from './utils.js';

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
