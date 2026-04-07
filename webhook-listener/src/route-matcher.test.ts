import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import polyline from '@mapbox/polyline';
import {
  haversineM,
  samplePolyline,
  routeSimilarity,
  sampleEncodedPolyline,
  matchAndAssignRoute,
} from './route-matcher.js';

type Point = [number, number];

afterEach(() => vi.unstubAllGlobals());

// ── Pure geometry ─────────────────────────────────────────────────────────────

describe('haversineM', () => {
  it('returns 0 for identical points', () => {
    expect(haversineM(59.368, 17.087, 59.368, 17.087)).toBe(0);
  });

  it('returns ~111 195m per degree of latitude', () => {
    const d = haversineM(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('samplePolyline', () => {
  it('returns empty array for empty input', () => {
    expect(samplePolyline([], 10)).toEqual([]);
  });

  it('returns all points when fewer than n', () => {
    const pts: Point[] = [[1, 0], [2, 0]];
    expect(samplePolyline(pts, 5)).toEqual(pts);
  });

  it('returns exactly n points for large input', () => {
    const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0] as Point);
    expect(samplePolyline(pts, 24)).toHaveLength(24);
  });

  it('always includes first and last point', () => {
    const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0] as Point);
    const sampled = samplePolyline(pts, 10);
    expect(sampled[0]).toEqual([0, 0]);
    expect(sampled[sampled.length - 1]).toEqual([99, 0]);
  });
});

describe('routeSimilarity', () => {
  it('returns 0 for identical point sets', () => {
    const pts: Point[] = [[59.368, 17.087], [59.370, 17.090]];
    expect(routeSimilarity(pts, pts)).toBe(0);
  });

  it('returns higher score for more different routes', () => {
    const a: Point[] = [[0, 0], [0.01, 0]];
    const same: Point[] = [[0, 0], [0.01, 0]];
    const far: Point[] = [[0, 1], [0.01, 1]]; // ~111km east
    expect(routeSimilarity(a, same)).toBeLessThan(routeSimilarity(a, far));
  });
});

describe('sampleEncodedPolyline', () => {
  it('returns at most SAMPLE_POINTS points', () => {
    const pts: Point[] = Array.from({ length: 50 }, (_, i) => [59 + i * 0.001, 17] as Point);
    const encoded = polyline.encode(pts);
    const sampled = sampleEncodedPolyline(encoded);
    expect(sampled.length).toBeLessThanOrEqual(24);
  });
});

// ── matchAndAssignRoute ───────────────────────────────────────────────────────

const STOCKHOLM_PTS: Point[] = [

  [59.368, 17.087], [59.370, 17.090], [59.372, 17.087], [59.370, 17.084],
];
const EQUATOR_PTS: Point[] = [
  [0, 0], [0, 0.1], [0, 0.2], [0, 0.1],
];
const STOCKHOLM_ENCODED = polyline.encode(STOCKHOLM_PTS);
const EQUATOR_ENCODED = polyline.encode(EQUATOR_PTS);

function makeDirectusResponse(rows: unknown[]) {
  return { ok: true, json: async () => ({ data: rows }) };
}
function makePatchResponse() {
  return { ok: true, json: async () => ({}) };
}

describe('matchAndAssignRoute', () => {
  // Set environment variable for all tests in this describe block
  const originalToken = process.env.DIRECTUS_TOKEN;
  beforeAll(() => {
    process.env.DIRECTUS_TOKEN = 'test-token';
  });
  afterAll(() => {
    if (originalToken) {
      process.env.DIRECTUS_TOKEN = originalToken;
    } else {
      delete process.env.DIRECTUS_TOKEN;
    }
  });

  it('patches route_name when polyline matches within threshold', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'Lundby_LötRygg_8km', summary_polyline: STOCKHOLM_ENCODED, distance_m: 8000 },
      ]))
      .mockResolvedValueOnce(makePatchResponse()),
    );

    await matchAndAssignRoute('act-001', STOCKHOLM_ENCODED, 8000);

    const fetchMock = vi.mocked(global.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const patchCall = fetchMock.mock.calls[1];
    expect(String(patchCall[0])).toContain('act-001');
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.route_name).toBe('Lundby_LötRygg_8km');
  });

  it('does not patch when polyline similarity exceeds threshold', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'FarRoute', summary_polyline: EQUATOR_ENCODED, distance_m: 8000 },
      ])),
    );

    await matchAndAssignRoute('act-002', STOCKHOLM_ENCODED, 8000);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('does not patch when distance differs by more than 10%', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'Lundby_LötRygg_8km', summary_polyline: STOCKHOLM_ENCODED, distance_m: 10_000 },
      ])),
    );

    await matchAndAssignRoute('act-003', STOCKHOLM_ENCODED, 8000);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('does not patch when no named routes exist', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([])),
    );

    await matchAndAssignRoute('act-004', STOCKHOLM_ENCODED, 8000);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });

  it('does not patch when distanceM is 0', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'TestRoute', summary_polyline: STOCKHOLM_ENCODED, distance_m: 0 },
      ])),
    );

    await matchAndAssignRoute('act-005', STOCKHOLM_ENCODED, 0);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1); // GET only, no PATCH
  });
});
