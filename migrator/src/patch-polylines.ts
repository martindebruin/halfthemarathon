import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCardioActivities } from './parse.js';
import { resolveGpxPath, parseGpxToPolyline } from './gpx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(ROOT, 'recovered');
const CSV_PATH = path.join(RECOVERED_DIR, 'cardioActivities.csv');

function getDirectusUrl(): string {
  return process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
}

function getToken(): string {
  const t = process.env.DIRECTUS_TOKEN;
  if (!t) throw new Error('DIRECTUS_TOKEN not set');
  return t;
}

async function directusFetch(reqPath: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${getDirectusUrl()}${reqPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Directus ${options.method ?? 'GET'} ${reqPath} failed ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  // Build map: runkeeperActivityId → gpxFilename
  console.log('Reading CSV...');
  const activities = parseCardioActivities(CSV_PATH);
  const gpxMap = new Map<string, string>();
  for (const a of activities) {
    if (a.gpxFile) gpxMap.set(a.activityId, a.gpxFile);
  }
  console.log(`CSV has ${gpxMap.size} activities with GPX files`);

  // Fetch all Runkeeper activities in Directus that are missing a polyline
  console.log('Fetching activities from Directus...');
  const result = await directusFetch(
    '/items/activities?filter[runkeeper_id][_nnull]=true&filter[summary_polyline][_null]=true&fields=id,runkeeper_id&limit=-1'
  ) as { data: Array<{ id: string; runkeeper_id: string }> };

  const toUpdate = result.data;
  console.log(`Found ${toUpdate.length} activities to patch`);

  if (toUpdate.length === 0) {
    console.log('Nothing to patch — either all activities already have polylines, or the Directus filter returned no results. Check connection and filters.');
    return;
  }

  let patched = 0;
  let skipped = 0;
  let errors = 0;

  for (const activity of toUpdate) {
    const gpxFilename = gpxMap.get(activity.runkeeper_id);
    if (!gpxFilename) {
      skipped++;
      continue;
    }

    const gpxPath = resolveGpxPath(gpxFilename);
    if (!gpxPath) {
      skipped++;
      continue;
    }

    try {
      const parsed = parseGpxToPolyline(gpxPath);
      if (!parsed) {
        skipped++;
        continue;
      }

      await directusFetch(`/items/activities/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          summary_polyline: parsed.polyline,
          start_lat: parsed.startLat,
          start_lng: parsed.startLng,
        }),
      });

      patched++;
      if (patched % 50 === 0) {
        console.log(`  ${patched} patched, ${skipped} skipped, ${errors} errors`);
      }
    } catch (err) {
      errors++;
      console.error(`Error patching activity ${activity.id} (runkeeper_id ${activity.runkeeper_id}):`, err);
    }
  }

  console.log(`\nDone. ${patched} patched, ${skipped} skipped (no GPX), ${errors} errors`);
}

main().catch((err) => { console.error(err); process.exit(1); });
