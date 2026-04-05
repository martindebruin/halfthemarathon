import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { parseCardioActivities, parsePhotos } from './parse.js';
import { resolveGpxPath } from './gpx.js';
import { StravaRateLimiter } from './rate-limiter.js';
import { refreshToken, uploadActivity, pollUpload, createManualActivity, getActivity, findActivityByDate } from './strava.js';
import { upsertActivity, upsertPhoto } from './directus.js';
import type { ProgressState, StravaActivity } from './types.js';

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
  const limiter = new StravaRateLimiter();

  let accessToken = '';
  let tokenExpiresAt = 0;

  async function ensureToken(): Promise<void> {
    if (Date.now() / 1000 < tokenExpiresAt - 300) return;
    const tok = await refreshToken();
    accessToken = tok.access_token;
    tokenExpiresAt = tok.expires_at;
  }

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
      await ensureToken();

      const gpxPath = activity.gpxFile ? resolveGpxPath(activity.gpxFile) : null;
      const externalId = `runkeeper_${activity.activityId}`;
      let stravaActivity: StravaActivity | null = null;

      if (gpxPath) {
        await limiter.acquire();
        // null return = 409 duplicate external_id
        const uploadResponse = await uploadActivity(accessToken, gpxPath, activity.routeName || 'Run', externalId);

        if (uploadResponse === null) {
          // 409: already uploaded — find by date
          await limiter.acquire();
          const found = await findActivityByDate(accessToken, activity.date);
          if (found) stravaActivity = found;
        } else {
          await limiter.acquire();
          const polled = await pollUpload(accessToken, uploadResponse.id);
          const resolvedId = polled.duplicate_of ?? polled.activity_id;
          if (resolvedId) {
            await limiter.acquire();
            stravaActivity = await getActivity(accessToken, resolvedId);
          }
        }
      } else {
        // Manual activity (no GPS)
        await limiter.acquire();
        const startDateLocal = activity.date.toISOString().replace('Z', '+00:00').slice(0, 19) + 'Z';
        stravaActivity = await createManualActivity(accessToken, {
          name: activity.routeName || 'Run',
          startDateLocal,
          elapsedTime: activity.durationSeconds,
          distance: activity.distanceKm * 1000,
        });
      }

      // Upsert to Directus (skipped if DIRECTUS_TOKEN not configured)
      let directusId: string | null = null;
      const photoList = photos.get(activity.activityId) ?? [];
      if (process.env.DIRECTUS_TOKEN) {
        directusId = await upsertActivity(activity, stravaActivity);
        for (const photo of photoList) {
          await upsertPhoto(directusId, photo, RECOVERED_DIR);
        }
      }

      state.completed.push(activity.activityId);
      state.lastRunAt = new Date().toISOString();
      saveProgress(state);

      console.log(`  OK ${label} | strava: ${stravaActivity?.id ?? 'none'} | photos: ${photoList.length} | short: ${limiter.shortRemaining} daily: ${limiter.dailyRemaining}`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Daily rate limit hit — wait until midnight UTC then resume
      if (errMsg.includes('overall rate limit')) {
        const now = new Date();
        const midnight = new Date();
        midnight.setUTCHours(24, 0, 5, 0); // 5s after midnight
        const waitMs = midnight.getTime() - now.getTime();
        const waitMin = Math.ceil(waitMs / 60000);
        console.log(`  Daily rate limit hit. Waiting ${waitMin} min until ${midnight.toISOString()} ...`);
        state.lastRunAt = now.toISOString();
        saveProgress(state);
        await new Promise((r) => setTimeout(r, waitMs));
        console.log('  Resuming after daily reset.');
        continue;
      }

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
