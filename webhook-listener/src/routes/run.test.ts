import { describe, it, expect } from 'vitest';
import { validateAppRunPayload } from './run.js';

const VALID = {
  app_run_id: '550e8400-e29b-41d4-a716-446655440000',
  started_at: '2026-04-04T07:12:00Z',
  distance_m: 8420,
  moving_time_s: 2640,
};

describe('validateAppRunPayload', () => {
  it('accepts a valid minimal payload', () => {
    expect(validateAppRunPayload(VALID)).toMatchObject({ valid: true });
  });

  it('accepts all optional fields', () => {
    const result = validateAppRunPayload({
      ...VALID,
      elapsed_time_s: 2780,
      avg_speed_ms: 3.19,
      start_lat: 59.334,
      start_lng: 18.063,
      summary_polyline: '_p~iF~ps|U',
      splits: [{ split: 1, distance: 1000, moving_time: 318, average_speed: 3.14, elevation_difference: 4 }],
    });
    expect(result).toMatchObject({ valid: true });
  });

  it('rejects null body', () => {
    expect(validateAppRunPayload(null)).toMatchObject({ valid: false });
  });

  it('rejects missing app_run_id', () => {
    const { app_run_id: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing started_at', () => {
    const { started_at: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing distance_m', () => {
    const { distance_m: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing moving_time_s', () => {
    const { moving_time_s: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects string distance_m', () => {
    expect(validateAppRunPayload({ ...VALID, distance_m: '8420' })).toMatchObject({ valid: false });
  });
});
