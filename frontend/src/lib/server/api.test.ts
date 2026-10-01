import { describe, it, expect } from 'vitest';
import { parseRunPatch, parsePaging, toRunSummary } from './api.js';

describe('parseRunPatch', () => {
  it('accepts the editable fields', () => {
    expect(parseRunPatch({ name: ' Kvällsrundan ', route_name: null, calories: 640, notes: 'blåsigt' }))
      .toEqual({ ok: true, patch: { name: 'Kvällsrundan', route_name: null, calories: 640, notes: 'blåsigt' } });
  });

  it('turns a cleared name into an empty string, as Directus stores it', () => {
    expect(parseRunPatch({ name: null })).toEqual({ ok: true, patch: { name: '' } });
  });

  it('rejects fields that are not editable', () => {
    const r = parseRunPatch({ distance_m: 1 });
    expect(r.ok).toBe(false);
  });

  it('rejects wrong types and an empty patch', () => {
    expect(parseRunPatch({ calories: -5 }).ok).toBe(false);
    expect(parseRunPatch({ calories: 'many' }).ok).toBe(false);
    expect(parseRunPatch({ notes: 3 }).ok).toBe(false);
    expect(parseRunPatch({}).ok).toBe(false);
    expect(parseRunPatch([]).ok).toBe(false);
    expect(parseRunPatch(null).ok).toBe(false);
  });
});

describe('parsePaging', () => {
  it('defaults and clamps', () => {
    expect(parsePaging(new URLSearchParams())).toEqual({ limit: 50, offset: 0, year: null });
    expect(parsePaging(new URLSearchParams('limit=5000&offset=-3&year=2026')))
      .toEqual({ limit: 500, offset: 0, year: 2026 });
    expect(parsePaging(new URLSearchParams('limit=abc&year=nope'))).toEqual({ limit: 50, offset: 0, year: null });
  });
});

describe('toRunSummary', () => {
  it('fills pace for runs without a recorded speed and exposes photo urls', () => {
    const s = toRunSummary({
      id: 7, date: '2026-09-29T15:32:45Z', name: 'X', route_name: null, source: 'app',
      distance_m: 10000, moving_time_s: 3000, average_speed: null,
      photos: [{ directus_file_id: 'abc' }, { directus_file_id: null }],
    } as never);
    expect(s.id).toBe('7');
    expect(s.average_speed).toBeCloseTo(3.333, 2);
    expect(s.photos).toEqual(['/photo/abc']);
  });
});
