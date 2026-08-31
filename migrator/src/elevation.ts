import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LatLng = [number, number];

const DEM_URL = 'https://api.opentopodata.org/v1';
const DEM_DATASET = process.env.DEM_DATASET ?? 'srtm30m';
const DEM_BATCH = 100;
const DEM_INTERVAL_MS = 1100;
const CACHE_PRECISION = 4;

export const SAMPLE_SPACING_M = 50;
export const GAIN_THRESHOLD_M = 3;
// Refuse to report a gain when the DEM could not resolve this much of the route.
export const MAX_MISSING_FRACTION = 0.2;

export function haversineMeters(a: LatLng, b: LatLng): number {
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
// running low point, so DEM/GPS jitter does not accumulate into phantom gain.
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

// The first split's elevation_difference was measured against a zero baseline
// instead of the run's starting altitude, so it holds an absolute altitude.
// There is no way to recover the real delta after the fact — zero it out.
export function fixFirstSplitElevation<T extends { elevation_difference?: number }>(splits: T[]): T[] {
  if (splits.length === 0) return splits;
  return splits.map((s, i) => (i === 0 ? { ...s, elevation_difference: 0 } : s));
}

function cacheKey(p: LatLng): string {
  return `${p[0].toFixed(CACHE_PRECISION)},${p[1].toFixed(CACHE_PRECISION)}`;
}

// Cached elevations are only valid for the dataset they came from.
function cacheFileKey(): string {
  return DEM_DATASET;
}

export class ElevationLookup {
  private cache = new Map<string, number>();
  private lastCall = 0;
  public apiCalls = 0;

  constructor(private cachePath?: string) {
    if (cachePath && existsSync(cachePath)) {
      const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, Record<string, number>>;
      for (const [k, v] of Object.entries(raw[cacheFileKey()] ?? {})) this.cache.set(k, v);
    }
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  save(): void {
    if (!this.cachePath) return;
    mkdirSync(dirname(this.cachePath), { recursive: true });
    const existing = existsSync(this.cachePath)
      ? (JSON.parse(readFileSync(this.cachePath, 'utf8')) as Record<string, Record<string, number>>)
      : {};
    existing[cacheFileKey()] = Object.fromEntries(this.cache);
    writeFileSync(this.cachePath, JSON.stringify(existing));
  }

  async lookup(points: LatLng[]): Promise<(number | null)[]> {
    const missing = [...new Set(points.map(cacheKey))].filter((k) => !this.cache.has(k));
    for (let i = 0; i < missing.length; i += DEM_BATCH) {
      await this.fetchBatch(missing.slice(i, i + DEM_BATCH));
    }
    return points.map((p) => this.cache.get(cacheKey(p)) ?? null);
  }

  private async fetchBatch(keys: string[]): Promise<void> {
    const wait = DEM_INTERVAL_MS - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const body = JSON.stringify({ locations: keys.join('|') });
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${DEM_URL}/${DEM_DATASET}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        this.lastCall = Date.now();
        this.apiCalls++;
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`OpenTopoData ${res.status}: ${await res.text()}`);
        const json = (await res.json()) as { results: { elevation: number | null }[] };
        json.results.forEach((r, i) => {
          if (r.elevation !== null) this.cache.set(keys[i], r.elevation);
        });
        return;
      } catch (err) {
        lastErr = err;
        this.lastCall = Date.now();
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw new Error(`DEM batch failed after retries: ${String(lastErr)}`);
  }
}

export async function gainForPolyline(
  polyline: string,
  lookup: ElevationLookup,
  decode: (s: string) => LatLng[]
): Promise<number | null> {
  const pts = decode(polyline);
  if (pts.length < 2) return null;
  const sampled = resamplePath(pts, SAMPLE_SPACING_M);
  const raw = await lookup.lookup(sampled);
  const known = raw.filter((e): e is number => e !== null);
  if (known.length < 2) return null;
  if ((raw.length - known.length) / raw.length > MAX_MISSING_FRACTION) return null;
  return elevationGain(known, GAIN_THRESHOLD_M);
}
