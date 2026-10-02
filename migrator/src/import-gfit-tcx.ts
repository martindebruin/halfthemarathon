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

// Google Fit starts a new <Lap> at every pause, and each lap's trackpoint
// <DistanceMeters> restarts at 0. Taking the last trackpoint as the run's
// distance therefore kept only the final lap, so distances are carried forward
// across laps and calories and lap times are summed.
function parseTcx(content: string): {
  activityId: string;
  calories: number | null;
  movingTimeS: number | null;
  points: Trackpoint[];
} {
  const idMatch = content.match(/<Id>([^<]+)<\/Id>/);
  const activityId = idMatch ? idMatch[1] : '';

  const laps = [...content.matchAll(/<Lap\b[\s\S]*?<\/Lap>/g)].map((m) => m[0]);
  if (laps.length === 0) laps.push(content);

  let calories: number | null = null;
  let movingTimeS: number | null = null;
  const points: Trackpoint[] = [];
  let offset = 0;
  for (const lap of laps) {
    // Lap-level fields sit outside <Track> (Google Fit writes them after it).
    const header = lap.replace(/<Track>[\s\S]*?<\/Track>/g, '');
    const calMatch = header.match(/<Calories>([^<]+)<\/Calories>/);
    if (calMatch) calories = (calories ?? 0) + parseFloat(calMatch[1]);
    const timeMatch = header.match(/<TotalTimeSeconds>([^<]+)<\/TotalTimeSeconds>/);
    if (timeMatch) movingTimeS = (movingTimeS ?? 0) + parseFloat(timeMatch[1]);

    let lapEnd = 0;
    for (const m of lap.matchAll(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g)) {
      const block = m[1];
      const distM = block.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/);
      const timeM = block.match(/<Time>([^<]+)<\/Time>/);
      const latM = block.match(/<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/);
      const lngM = block.match(/<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/);
      const eleM = block.match(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/);
      if (!distM || !timeM) continue;
      const d = parseFloat(distM[1]);
      lapEnd = Math.max(lapEnd, d);
      points.push({
        distanceM: offset + d,
        time: new Date(timeM[1]).getTime(),
        lat: latM ? parseFloat(latM[1]) : null,
        lng: lngM ? parseFloat(lngM[1]) : null,
        ele: eleM ? parseFloat(eleM[1]) : null,
      });
    }
    offset += lapEnd;
  }
  return { activityId, calories, movingTimeS, points };
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

// --repair rewrites the derived fields of runs already imported (distance,
// time, pace, calories, splits) and leaves names, routes, elevation and photos.
const REPAIR = process.argv.includes('--repair');
const APPLY = process.argv.includes('--apply');

async function main() {
  if (REPAIR && !APPLY) console.log('=== DRY RUN — pass --apply to write ===');
  const files = await glob('*.tcx', { cwd: TCX_DIR, absolute: true });
  console.log(`Found ${files.length} TCX files in ${TCX_DIR}`);

  let ok = 0, fail = 0, skip = 0;
  for (const file of files) {
    const filename = path.basename(file);
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const { activityId, calories, movingTimeS, points } = parseTcx(content);
      if (!activityId || points.length === 0) {
        console.log(`  SKIP ${filename}: no id/points`);
        skip++;
        continue;
      }

      const gfitId = `gfit_${activityId}`;
      const existing = await directusFetch(
        `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(gfitId)}` +
        `&fields=id,distance_m,moving_time_s,calories`
      );

      const withGps = points.filter((p) => p.lat !== null && p.lng !== null);
      const first = points[0];
      const last = points[points.length - 1];
      const durationSeconds = Math.round((last.time - first.time) / 1000);
      const movingSeconds = movingTimeS != null ? Math.round(movingTimeS) : durationSeconds;
      const distanceM = last.distanceM;
      const splits = computeSplits(points);

      if (existing.data.length > 0) {
        const row = existing.data[0];
        const changed = Math.abs((row.distance_m ?? 0) - distanceM) > 1 ||
          row.moving_time_s !== movingSeconds ||
          Math.abs((row.calories ?? 0) - (calories ?? 0)) > 0.5;
        if (!REPAIR || !changed) {
          console.log(`  SKIP ${filename}: already imported${REPAIR ? ', unchanged' : ''}`);
          skip++;
          continue;
        }
        console.log(`  REPAIR ${row.id} ${filename}: ` +
          `${Math.round(row.distance_m)}m/${row.moving_time_s}s/${Math.round(row.calories ?? 0)}kcal -> ` +
          `${Math.round(distanceM)}m/${movingSeconds}s/${Math.round(calories ?? 0)}kcal`);
        if (APPLY) {
          await directusFetch(`/items/activities/${row.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              distance_m: distanceM,
              moving_time_s: movingSeconds,
              elapsed_time_s: durationSeconds,
              average_speed: movingSeconds > 0 ? distanceM / movingSeconds : null,
              calories,
              splits_metric: splits.length ? JSON.stringify(splits) : null,
            }),
          });
        }
        ok++;
        continue;
      }
      if (REPAIR) {
        console.log(`  SKIP ${filename}: not imported yet (repair only touches existing runs)`);
        skip++;
        continue;
      }

      const record: Record<string, unknown> = {
        runkeeper_id: gfitId,
        source: 'googlefit',
        date: new Date(first.time).toISOString(),
        name: 'Löpning',
        route_name: null,
        type: 'Run',
        distance_m: distanceM,
        moving_time_s: movingSeconds,
        elapsed_time_s: durationSeconds,
        average_speed: movingSeconds > 0 ? distanceM / movingSeconds : null,
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
