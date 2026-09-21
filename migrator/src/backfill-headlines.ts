/**
 * backfill-headlines.ts
 *
 * Regenerates the `name` of every activity using the church-year naming
 * system — the same code path the webhook-listener runs on new uploads, so
 * backfilled titles and future ones come from one prompt.
 *
 * Reverse-geocode results are cached by coordinates rounded to ~1 km, which
 * collapses ~840 Nominatim lookups into a handful — the prompt only wants the
 * city name, so finer keys just buy extra rate-limited round trips. Live calls
 * are spaced 1.1 s apart to stay inside Nominatim's usage policy.
 *
 * Usage:
 *   npm run backfill-headlines                  # dry run, whole archive
 *   npm run backfill-headlines -- --limit 5     # dry run, first 5
 *   npm run backfill-headlines -- --apply       # write names to Directus
 *   npm run backfill-headlines -- --pending-only --apply   # only runs not yet renamed
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getSwedishDayLabel,
  getTimeOfDayLabel,
  generateHeadline,
} from '../../webhook-listener/src/headline.js';
import { fetchNearestHoliday, type Holiday } from '../../webhook-listener/src/kyrkoaret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const PENDING_ONLY = process.argv.includes('--pending-only');
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const CACHE_PATH = path.resolve(__dirname, '../.geocode-cache.json');
const NOMINATIM_SPACING_MS = 1100;

interface ActivityRow {
  id: number;
  date: string;
  name: string | null;
  start_lat: number | null;
  start_lng: number | null;
  distance_m: number | null;
  total_elevation_gain: number | null;
}

/**
 * True when `name` is still one of the pre-church-year shapes: blank, the
 * imported Runkeeper route label, plain "Löpning", or the old weekday
 * fallback. A generated title matches none of these, so this is the set a
 * mop-up pass needs to revisit after a partial run.
 */
export function isPendingName(name: string | null): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  if (n === 'Löpning') return true;
  if (/^[A-ZÅÄÖ0-9][A-Za-zÅÄÖåäö0-9]*_/.test(n)) return true;
  if (/^\d+\s?km\b/i.test(n)) return true;
  if (/löpning\s+(i\s+\S+\s+)?(på|vid)\s/i.test(n)) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchActivities(): Promise<ActivityRow[]> {
  const fields = 'id,date,name,start_lat,start_lng,distance_m,total_elevation_gain';
  const res = await fetch(`${DIRECTUS_URL}/items/activities?limit=-1&sort=date&fields=${fields}`, {
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${await res.text()}`);
  return (await res.json() as { data: ActivityRow[] }).data;
}

async function patchName(id: number, name: string): Promise<void> {
  const res = await fetch(`${DIRECTUS_URL}/items/activities/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Caches — geocoding is rate limited, holidays repeat across years
// ---------------------------------------------------------------------------

type GeoCache = Record<string, string | null>;

function loadCache(): GeoCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as GeoCache;
  } catch {
    return {};
  }
}

const geoCache = loadCache();
let geoCacheDirty = false;

function saveCache(): void {
  if (!geoCacheDirty) return;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(geoCache, null, 2));
  geoCacheDirty = false;
}

let lastNominatimAt = 0;

async function cachedPlace(lat: number, lng: number): Promise<string | null> {
  // 2 decimals ~ 1 km. Finer keys split one town across many lookups.
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (key in geoCache) return geoCache[key];

  const wait = NOMINATIM_SPACING_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await sleep(wait);
  lastNominatimAt = Date.now();

  let place: string | null = null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=sv`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'htmitub-backfill/1.0 (martin)' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json() as { address?: Record<string, string> };
      const a = data.address ?? {};
      place = a.city ?? a.town ?? a.village ?? a.municipality ?? null;
    }
  } catch {
    place = null;
  }

  geoCache[key] = place;
  geoCacheDirty = true;
  saveCache();
  return place;
}

const holidayCache = new Map<string, Holiday | null>();

async function cachedHoliday(date: Date): Promise<Holiday | null> {
  const key = date.toISOString().slice(0, 10);
  if (!holidayCache.has(key)) holidayCache.set(key, await fetchNearestHoliday(date));
  return holidayCache.get(key)!;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!APPLY) console.log('=== DRY RUN — pass --apply to write names ===\n');

  const all = await fetchActivities();
  const candidates = PENDING_ONLY ? all.filter((r) => isPendingName(r.name)) : all;
  const rows = candidates.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  if (PENDING_ONLY) {
    console.log(`${all.length} activities, ${candidates.length} still unnamed, processing ${rows.length}\n`);
  } else {
    console.log(`${all.length} activities, processing ${rows.length}\n`);
  }

  let done = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const row of rows) {
    const date = new Date(row.date);
    try {
      const [place, holiday] = await Promise.all([
        row.start_lat != null && row.start_lng != null
          ? cachedPlace(row.start_lat, row.start_lng)
          : Promise.resolve(null),
        cachedHoliday(date),
      ]);

      const title = await generateHeadline(
        place,
        getSwedishDayLabel(date),
        getTimeOfDayLabel(date),
        holiday,
        { distanceM: row.distance_m, elevationGainM: row.total_elevation_gain },
      );

      if (APPLY) await patchName(row.id, title);
      done++;

      const holidayLabel = holiday
        ? `${holiday.sv}${holiday.offsetDays === 0 ? '' : ` ${holiday.offsetDays > 0 ? '+' : ''}${holiday.offsetDays}d`}`
        : 'no holiday';
      const rate = (Date.now() - startedAt) / done / 1000;
      console.log(
        `[${done}/${rows.length}] ${row.date.slice(0, 10)} ${String(row.id).padEnd(4)} ` +
        `${holidayLabel.padEnd(28)} ${JSON.stringify(row.name ?? '')} -> ${JSON.stringify(title)}  (${rate.toFixed(1)}s/run)`,
      );
    } catch (err) {
      failed++;
      console.error(`[!] ${row.id} failed: ${String(err)}`);
    }
  }

  saveCache();
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Named: ${done}  |  failed: ${failed}  |  ${mins} min`);
  if (!APPLY) console.log('\nRe-run with --apply to write names.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  saveCache();
  process.exit(1);
});
