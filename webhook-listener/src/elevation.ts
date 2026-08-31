import polyline from '@mapbox/polyline';

export type LatLng = [number, number];

const DEM_URL = 'https://api.opentopodata.org/v1';
const DEM_DATASET = process.env.DEM_DATASET ?? 'srtm30m';
const DEM_BATCH = 100;
const DEM_INTERVAL_MS = 1100;
const CACHE_PRECISION = 4;
const CACHE_MAX = 200_000;

const SAMPLE_SPACING_M = 50;
const GAIN_THRESHOLD_M = 3;
// Refuse to report a gain when the DEM could not resolve this much of the route.
const MAX_MISSING_FRACTION = 0.2;

// Shared across requests for the container's lifetime. Routes repeat heavily,
// so this keeps the DEM call count near zero for familiar runs.
const cache = new Map<string, number>();
let lastCall = 0;

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function resamplePath(points: LatLng[], spacingM: number): LatLng[] {
  if (points.length < 2) return points;
  const kept: LatLng[] = [points[0]];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += haversineMeters(points[i - 1], points[i]);
    if (acc >= spacingM) {
      kept.push(points[i]);
      acc = 0;
    }
  }
  const last = points[points.length - 1];
  const tail = kept[kept.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) kept.push(last);
  return kept;
}

// Hysteresis filter: only bank a climb once it exceeds thresholdM above the
// running low point, so DEM jitter does not accumulate into phantom gain.
export function elevationGain(elevations: number[], thresholdM: number): number {
  if (elevations.length < 2) return 0;
  let gain = 0;
  let low = elevations[0];
  let high = elevations[0];
  let climbing = false;

  for (const e of elevations) {
    if (climbing) {
      if (e > high) high = e;
      else if (high - e > thresholdM) {
        gain += high - low;
        low = e;
        high = e;
        climbing = false;
      }
    } else {
      if (e < low) low = e;
      else if (e - low > thresholdM) {
        high = e;
        climbing = true;
      }
    }
  }
  if (climbing) gain += high - low;
  return Math.round(gain * 10) / 10;
}

function cacheKey(p: LatLng): string {
  return `${p[0].toFixed(CACHE_PRECISION)},${p[1].toFixed(CACHE_PRECISION)}`;
}

// Cached elevations are only valid for the dataset they came from.
function cacheFileKey(): string {
  return DEM_DATASET;
}

async function fetchBatch(keys: string[]): Promise<void> {
  const wait = DEM_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

  const res = await fetch(`${DEM_URL}/${DEM_DATASET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: keys.join('|') }),
  });
  lastCall = Date.now();
  if (!res.ok) throw new Error(`OpenTopoData ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { results: { elevation: number | null }[] };
  if (cache.size > CACHE_MAX) cache.clear();
  json.results.forEach((r, i) => {
    if (r.elevation !== null) cache.set(keys[i], r.elevation);
  });
}

export async function elevationGainForPolyline(encoded: string): Promise<number | null> {
  const pts = polyline.decode(encoded) as LatLng[];
  if (pts.length < 2) return null;

  const sampled = resamplePath(pts, SAMPLE_SPACING_M);
  const missing = [...new Set(sampled.map(cacheKey))].filter((k) => !cache.has(k));
  for (let i = 0; i < missing.length; i += DEM_BATCH) {
    await fetchBatch(missing.slice(i, i + DEM_BATCH));
  }

  const known = sampled
    .map((p) => cache.get(cacheKey(p)))
    .filter((e): e is number => e !== undefined);
  if (known.length < 2) return null;
  if ((sampled.length - known.length) / sampled.length > MAX_MISSING_FRACTION) return null;
  return elevationGain(known, GAIN_THRESHOLD_M);
}
