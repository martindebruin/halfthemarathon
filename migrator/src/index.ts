import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { parseCardioActivities, parsePhotos } from './parse.js';
import { resolveGpxPath, parseGpxToPolyline, computeSplitsFromGpx } from './gpx.js';
import { upsertActivity, upsertPhoto, type GpxComputed } from './directus.js';
import type { ProgressState } from './types.js';

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(DATA_ROOT, 'recovered');
const STATE_FILE = path.resolve(__dirname, '../state/progress.json');

function loadProgress(): ProgressState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as ProgressState;
  }
  return { completed: [], failed: [], lastRunAt: '' };
}

function saveProgress(state: ProgressState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function formatActivity(i: number, total: number, id: string, name: string): string {
  return `[${i}/${total}] ${id.slice(0, 8)}... ${name}`;
}

async function main(): Promise<void> {
  if (DRY_RUN) console.log('=== DRY RUN MODE — no API calls will be made ===\n');

  const activities = parseCardioActivities(path.join(RECOVERED_DIR, 'cardioActivities.csv'));
  const photos = parsePhotos(path.join(RECOVERED_DIR, 'photos.csv'));
  const state = loadProgress();
  const completedSet = new Set(state.completed);

  const remaining = activities.filter((a) => !completedSet.has(a.activityId));
  console.log(`Total activities: ${activities.length}, already done: ${completedSet.size}, remaining: ${remaining.length}`);

  let i = completedSet.size;
  for (const activity of remaining) {
    i++;
    const label = formatActivity(i, activities.length, activity.activityId, activity.routeName);

    if (DRY_RUN) {
      const gpxPath = activity.gpxFile ? resolveGpxPath(activity.gpxFile) : null;
      const photoList = photos.get(activity.activityId) ?? [];
      console.log(`${label} | GPX: ${gpxPath ? 'yes' : 'NO'} | photos: ${photoList.length}`);
      continue;
    }

    try {
      const gpxPath = activity.gpxFile ? resolveGpxPath(activity.gpxFile) : null;
      let gpxData: GpxComputed | null = null;
      if (gpxPath) {
        const parsed = parseGpxToPolyline(gpxPath);
        if (parsed) {
          gpxData = {
            polyline: parsed.polyline,
            startLat: parsed.startLat,
            startLng: parsed.startLng,
            splits: computeSplitsFromGpx(gpxPath),
          };
        }
      }

      // Upsert to Directus (skipped if DIRECTUS_TOKEN not configured)
      let directusId: string | null = null;
      const photoList = photos.get(activity.activityId) ?? [];
      if (process.env.DIRECTUS_TOKEN) {
        directusId = await upsertActivity(activity, gpxData);
        for (const photo of photoList) {
          await upsertPhoto(directusId, photo, RECOVERED_DIR);
        }
      }

      state.completed.push(activity.activityId);
      state.lastRunAt = new Date().toISOString();
      saveProgress(state);

      console.log(`  OK ${label} | gpx: ${gpxPath ? 'yes' : 'no'} | splits: ${gpxData?.splits.length ?? 0} | photos: ${photoList.length}`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${label}: ${errMsg}`);

      const existing = state.failed.find((f) => f.id === activity.activityId);
      if (existing) {
        existing.error = errMsg;
        existing.attempts++;
      } else {
        state.failed.push({ id: activity.activityId, error: errMsg, attempts: 1 });
      }
      state.lastRunAt = new Date().toISOString();
      saveProgress(state);
    }
  }

  console.log(`\nDone. Completed: ${state.completed.length}, Failed: ${state.failed.length}`);
  if (state.failed.length > 0) {
    console.log('Failed activities:');
    for (const f of state.failed) {
      console.log(`  ${f.id}: ${f.error} (${f.attempts} attempts)`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
