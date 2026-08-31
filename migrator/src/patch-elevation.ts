import 'dotenv/config';
import polyline from '@mapbox/polyline';
import {
  ElevationLookup,
  fixFirstSplitElevation,
  gainForPolyline,
  type LatLng,
} from './elevation.js';

const CACHE_PATH = process.env.DEM_CACHE ?? '.dem-cache.json';
const DRY_RUN = process.argv.includes('--dry-run');

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

const decode = (s: string): LatLng[] => polyline.decode(s) as LatLng[];

interface Activity {
  id: string;
  date: string;
  summary_polyline: string | null;
  splits_metric: unknown;
  total_elevation_gain: number | null;
}

// Directus returns a json column as an already-parsed array, but older rows
// were written as a JSON string. Accept either shape.
function toSplits(raw: unknown): { elevation_difference?: number }[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function repairSplits(raw: unknown): { elevation_difference?: number }[] | null {
  const splits = toSplits(raw);
  if (!splits || splits.length === 0) return null;
  if (splits[0].elevation_difference === 0) return null; // already correct
  return fixFirstSplitElevation(splits);
}

async function main(): Promise<void> {
  const res = (await directusFetch(
    '/items/activities?limit=-1&sort=date' +
      '&fields=id,date,summary_polyline,splits_metric,total_elevation_gain'
  )) as { data: Activity[] };
  const activities = res.data;

  const lookup = new ElevationLookup(CACHE_PATH);
  console.log(
    `${activities.length} activities, DEM cache primed with ${lookup.cacheSize} points` +
      (DRY_RUN ? ' (dry run)' : '')
  );

  let gainPatched = 0;
  let splitsPatched = 0;
  let skipped = 0;
  let done = 0;

  for (const a of activities) {
    const patch: Record<string, unknown> = {};

    if (a.summary_polyline) {
      try {
        const gain = await gainForPolyline(a.summary_polyline, lookup, decode);
        if (gain !== null) patch.total_elevation_gain = gain;
      } catch (err) {
        console.error(`  ${a.date.slice(0, 10)} ${a.id}: DEM lookup failed - ${String(err)}`);
      }
    }

    const splits = repairSplits(a.splits_metric);
    if (splits) patch.splits_metric = splits;

    if (Object.keys(patch).length === 0) {
      skipped++;
    } else {
      if (!DRY_RUN) {
        await directusFetch(`/items/activities/${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
      }
      if ('total_elevation_gain' in patch) gainPatched++;
      if ('splits_metric' in patch) splitsPatched++;
      console.log(
        `  ${a.date.slice(0, 10)} gain=${patch.total_elevation_gain ?? '-'}m` +
          (splits ? ' splits-fixed' : '')
      );
    }

    done++;
    if (done % 50 === 0) {
      lookup.save();
      console.log(`[${done}/${activities.length}] ${lookup.apiCalls} DEM calls so far`);
    }
  }

  lookup.save();
  console.log(
    `\nDone. elevation gain: ${gainPatched}, splits repaired: ${splitsPatched}, ` +
      `unchanged: ${skipped}, DEM API calls: ${lookup.apiCalls}, cached points: ${lookup.cacheSize}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
