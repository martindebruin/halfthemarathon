/**
 * One-off importer for 2026 running activities recovered from a Google Takeout
 * export (Fitness/Aktiviteter/*.tcx), for runs done after the server wipe
 * that never made it into the Runkeeper/Strava historical export.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import glob from 'fast-glob';
import polyline from '@mapbox/polyline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE = process.env.DIRECTUS_PUBLIC_URL ?? process.env.DIRECTUS_INTERNAL_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const TCX_DIR = path.resolve(__dirname, '../../gfit-2026-runs/Takeout/Fitness/Aktiviteter');

interface Trackpoint {
  distanceM: number;
  time: number; // epoch ms
  lat: number | null;
  lng: number | null;
  ele: number | null;
}

function parseTcx(content: string): { activityId: string; calories: number | null; points: Trackpoint[] } {
  const idMatch = content.match(/<Id>([^<]+)<\/Id>/);
  const activityId = idMatch ? idMatch[1] : '';

  const calMatch = content.match(/<Calories>([^<]+)<\/Calories>/);
  const calories = calMatch ? parseFloat(calMatch[1]) : null;

  const points: Trackpoint[] = [];
  const tpMatches = [...content.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)];
  for (const m of tpMatches) {
    const block = m[1];
    const distM = block.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/);
    const timeM = block.match(/<Time>([^<]+)<\/Time>/);
    const latM = block.match(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/);
    const lngM = block.match(/<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/);
    const eleM = block.match(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/);
    if (!distM || !timeM) continue;
    points.push({
      distanceM: parseFloat(distM[1]),
      time: new Date(timeM[1]).getTime(),
      lat: latM ? parseFloat(latM[1]) : null,
      lng: lngM ? parseFloat(lngM[1]) : null,
      ele: eleM ? parseFloat(eleM[1]) : null,
    });
  }
  return { activityId, calories, points };
}

// A missing altitude must not be treated as sea level - that turns the first
// split's delta into an absolute altitude. Report 0 when either end is unknown.
function eleDiff(start: Trackpoint, end: Trackpoint): number {
  if (start.ele == null || end.ele == null) return 0;
  return end.ele - start.ele;
}

function computeSplits(points: Trackpoint[]): object[] {
  if (points.length < 2) return [];
  const splits: object[] = [];
  const SPLIT_METERS = 1000;
  let splitStartIdx = 0;
  let splitNum = 1;

  for (let i = 1; i < points.length; i++) {
    const distSinceSplitStart = points[i].distanceM - points[splitStartIdx].distanceM;
    if (distSinceSplitStart >= SPLIT_METERS) {
      const start = points[splitStartIdx];
      const end = points[i];
      const elapsed = (end.time - start.time) / 1000;
      const dist = end.distanceM - start.distanceM;
      splits.push({
        split: splitNum++,
        distance: Math.round(dist),
        moving_time: Math.round(elapsed),
        elapsed_time: Math.round(elapsed),
        average_speed: elapsed > 0 ? dist / elapsed : 0,
        elevation_difference: eleDiff(start, end),
      });
      splitStartIdx = i;
    }
  }
  const last = points[points.length - 1];
  const start = points[splitStartIdx];
  const remaining = last.distanceM - start.distanceM;
  if (remaining > 20) {
    const elapsed = (last.time - start.time) / 1000;
    splits.push({
      split: splitNum,
      distance: Math.round(remaining),
      moving_time: Math.round(elapsed),
      elapsed_time: Math.round(elapsed),
      average_speed: elapsed > 0 ? remaining / elapsed : 0,
      elevation_difference: eleDiff(start, last),
    });
  }
  return splits;
}

async function directusFetch(reqPath: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${reqPath}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${reqPath} -> ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  const files = await glob('*.tcx', { cwd: TCX_DIR, absolute: true });
  console.log(`Found ${files.length} TCX files in ${TCX_DIR}`);

  let ok = 0, fail = 0, skip = 0;
  for (const file of files) {
    const filename = path.basename(file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const { activityId, calories, points } = parseTcx(content);
      if (!activityId || points.length === 0) {
        console.log(`  SKIP ${filename}: no id/points`);
        skip++;
        continue;
      }

      const gfitId = `gfit_${activityId}`;
      const existing = await directusFetch(
        `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(gfitId)}&fields=id`
      );
      if (existing.data.length > 0) {
        console.log(`  SKIP ${filename}: already imported`);
        skip++;
        continue;
      }

      const withGps = points.filter((p) => p.lat !== null && p.lng !== null);
      const first = points[0];
      const last = points[points.length - 1];
      const durationSeconds = Math.round((last.time - first.time) / 1000);
      const distanceM = last.distanceM;
      const splits = computeSplits(points);

      const record: Record<string, unknown> = {
        runkeeper_id: gfitId,
        source: 'googlefit',
        date: new Date(first.time).toISOString(),
        name: 'Löpning',
        route_name: null,
        type: 'Run',
        distance_m: distanceM,
        moving_time_s: durationSeconds,
        elapsed_time_s: durationSeconds,
        average_speed: durationSeconds > 0 ? distanceM / durationSeconds : null,
        calories,
        splits_metric: splits.length ? JSON.stringify(splits) : null,
      };

      if (withGps.length > 0) {
        record.summary_polyline = polyline.encode(withGps.map((p) => [p.lat as number, p.lng as number]));
        record.start_lat = withGps[0].lat;
        record.start_lng = withGps[0].lng;
      }

      await directusFetch('/items/activities', { method: 'POST', body: JSON.stringify(record) });
      console.log(`  OK ${filename} | dist=${(distanceM / 1000).toFixed(2)}km | dur=${durationSeconds}s | splits=${splits.length} | gps=${withGps.length}/${points.length}`);
      ok++;
    } catch (err) {
      console.error(`  FAIL ${filename}: ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail} skip=${skip}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
