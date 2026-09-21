import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import polyline from '@mapbox/polyline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(__dirname, '../..');
const ROUTES_DIR = path.join(DATA_ROOT, 'routes');
const RECOVERED_DIR = path.join(DATA_ROOT, 'recovered');

export function resolveGpxPath(filename: string): string | null {
  if (!filename) return null;
  const inRoutes = path.join(ROUTES_DIR, filename);
  if (fs.existsSync(inRoutes)) return inRoutes;
  const inRecovered = path.join(RECOVERED_DIR, filename);
  if (fs.existsSync(inRecovered)) return inRecovered;
  return null;
}

const MAX_TRACKPOINTS = 500;

/**
 * Extracts [lat, lng] pairs from GPX XML content.
 * Subsamples to MAX_TRACKPOINTS if the track is longer.
 */
export function extractTrackpoints(content: string): [number, number][] {
  const matches = [...content.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)];
  const all: [number, number][] = matches.map((m) => [parseFloat(m[1]), parseFloat(m[2])]);

  if (all.length === 0) return [];
  if (all.length <= MAX_TRACKPOINTS) return all;

  const step = Math.ceil(all.length / MAX_TRACKPOINTS);
  const sampled = all.filter((_, i) => i % step === 0);
  // Ensure the last point is included, but don't exceed MAX_TRACKPOINTS
  while (sampled.length > MAX_TRACKPOINTS) {
    sampled.pop();
  }
  if (sampled[sampled.length - 1] !== all[all.length - 1]) {
    sampled.push(all[all.length - 1]);
  }
  return sampled.slice(0, MAX_TRACKPOINTS);
}

/**
 * Reads a GPX file and returns a Google Encoded Polyline plus start coordinates.
 * Returns null if the file has no trackpoints.
 */
export function parseGpxToPolyline(
  filePath: string
): { polyline: string; startLat: number; startLng: number } | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const points = extractTrackpoints(content);
  if (points.length === 0) return null;

  return {
    polyline: polyline.encode(points),
    startLat: points[0][0],
    startLng: points[0][1],
  };
}

interface TimedPoint {
  lat: number;
  lng: number;
  ele: number | null;
  time: number; // epoch ms
}

function extractTimedTrackpoints(content: string): TimedPoint[] {
  const matches = [...content.matchAll(
    /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">(?:<ele>([^<]*)<\/ele>)?<time>([^<]+)<\/time>/g
  )];
  return matches.map((m) => ({
    lat: parseFloat(m[1]),
    lng: parseFloat(m[2]),
    ele: m[3] ? parseFloat(m[3]) : null,
    time: new Date(m[4]).getTime(),
  }));
}

function haversineMeters(a: TimedPoint, b: TimedPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface ComputedSplit {
  split: number;
  distance: number; // meters, ~1000 except final partial split
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  average_speed: number; // m/s
  elevation_difference: number; // meters
}

/**
 * Computes 1km splits directly from GPX trackpoint timestamps + haversine distance.
 * Standalone replacement for Strava's splits_metric now that historical data
 * comes only from the Runkeeper GPX export.
 */
export function computeSplitsFromGpx(filePath: string): ComputedSplit[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const points = extractTimedTrackpoints(content);
  if (points.length < 2) return [];

  const splits: ComputedSplit[] = [];
  let splitDistance = 0;
  let splitStartTime = points[0].time;
  let splitStartEle = points[0].ele ?? 0;
  let splitNum = 1;
  const SPLIT_METERS = 1000;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const segMeters = haversineMeters(prev, cur);
    splitDistance += segMeters;

    if (splitDistance >= SPLIT_METERS) {
      const elapsed = (cur.time - splitStartTime) / 1000;
      splits.push({
        split: splitNum++,
        distance: Math.round(splitDistance),
        moving_time: Math.round(elapsed),
        elapsed_time: Math.round(elapsed),
        average_speed: elapsed > 0 ? splitDistance / elapsed : 0,
        elevation_difference: (cur.ele ?? splitStartEle) - splitStartEle,
      });
      splitDistance = 0;
      splitStartTime = cur.time;
      splitStartEle = cur.ele ?? splitStartEle;
    }
  }

  // Final partial split
  if (splitDistance > 20) {
    const last = points[points.length - 1];
    const elapsed = (last.time - splitStartTime) / 1000;
    splits.push({
      split: splitNum,
      distance: Math.round(splitDistance),
      moving_time: Math.round(elapsed),
      elapsed_time: Math.round(elapsed),
      average_speed: elapsed > 0 ? splitDistance / elapsed : 0,
      elevation_difference: (last.ele ?? splitStartEle) - splitStartEle,
    });
  }

  return splits;
}
