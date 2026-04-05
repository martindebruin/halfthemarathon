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
