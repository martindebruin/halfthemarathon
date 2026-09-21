/**
 * name-routes.ts
 *
 * Finds all activities that still fall into geo-based cluster keys (i.e. have
 * no route_name set) and auto-names them by reverse-geocoding the start
 * coordinates via Nominatim, then patching route_name to "Place_Xkm".
 *
 * Nominatim ToS: 1 req/sec, identify with a meaningful User-Agent.
 *
 * Usage:
 *   npm run name-routes           # dry run
 *   npm run name-routes -- --apply
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Directus
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  route_name: string | null;
  distance_m: number | null;
  start_lat: number | null;
  start_lng: number | null;
}

async function fetchActivities(): Promise<ActivityRow[]> {
  const res = await fetch(
    `${DIRECTUS_URL}/items/activities?limit=-1&fields=id,route_name,distance_m,start_lat,start_lng`,
    { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { data: ActivityRow[] }).data;
}

async function patchRouteName(id: string, routeName: string): Promise<void> {
  const res = await fetch(`${DIRECTUS_URL}/items/activities/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ route_name: routeName }),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Cluster key (mirrors stats.ts)
// ---------------------------------------------------------------------------

function clusterKey(a: ActivityRow): string | null {
  if (a.route_name) return `name:${a.route_name}`;
  if (a.start_lat != null && a.start_lng != null && a.distance_m != null) {
    const lat = a.start_lat.toFixed(3);
    const lng = a.start_lng.toFixed(3);
    const distKm = Math.round(a.distance_m / 1000);
    return `geo:${lat}_${lng}_${distKm}km`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nominatim reverse geocoding
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  await sleep(1100); // respect 1 req/sec
  // zoom=14 gives neighbourhood-level names rather than city-level
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'htmitub-route-namer/1.0 (personal running analytics)' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json() as {
    address: Record<string, string>;
    display_name: string;
  };

  const addr = data.address;
  // Pick the most specific useful place name, neighbourhood before city
  const place =
    addr['neighbourhood'] ??
    addr['suburb'] ??
    addr['village'] ??
    addr['town'] ??
    addr['city_district'] ??
    addr['city'] ??
    addr['municipality'] ??
    addr['county'] ??
    'Unknown';

  return place
    // Strip Swedish administrative suffixes that Nominatim sometimes returns
    .replace(/\s+stadsdelsområde$/i, '')
    .replace(/\s+(stad|kommun|tätort|socken|församling|distrikt)$/i, '')
    .replace(/\s+/g, '_')
    // Strip Swedish genitive -s added to city names (Ljusdals→Ljusdal, Ängelholms→Ängelholm)
    .replace(/(dal|holm|vall|by|arp|berg|ås|vik|hamn|fors|land|mark)s$/i, '$1');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!APPLY) console.log('=== DRY RUN — pass --apply to write changes ===\n');

  console.log(`Fetching activities from ${DIRECTUS_URL} ...`);
  const activities = await fetchActivities();
  console.log(`  ${activities.length} activities\n`);

  // Group geo-only clusters by key
  const geoClusters = new Map<string, ActivityRow[]>();
  for (const a of activities) {
    const key = clusterKey(a);
    if (!key || !key.startsWith('geo:')) continue;
    if (!geoClusters.has(key)) geoClusters.set(key, []);
    geoClusters.get(key)!.push(a);
  }

  if (geoClusters.size === 0) {
    console.log('No unnamed geo-clusters remaining.');
    return;
  }

  console.log(`Found ${geoClusters.size} unnamed geo-clusters. Reverse-geocoding start points...\n`);

  // Cache geocoding results (same location may appear for multiple clusters)
  const geocodeCache = new Map<string, string>();

  let totalUpdated = 0;

  for (const [key, rows] of geoClusters) {
    // Pick a representative activity (prefer one with start coords)
    const rep = rows.find((r) => r.start_lat != null && r.start_lng != null) ?? rows[0];
    if (rep.start_lat == null || rep.start_lng == null || rep.distance_m == null) {
      console.log(`[skip]  ${key} — no coordinates`);
      continue;
    }

    // Round to 2dp for cache key (~1km precision)
    const cacheKey = `${rep.start_lat.toFixed(2)}_${rep.start_lng.toFixed(2)}`;
    let placeName = geocodeCache.get(cacheKey);
    if (!placeName) {
      try {
        placeName = await reverseGeocode(rep.start_lat, rep.start_lng);
        geocodeCache.set(cacheKey, placeName);
      } catch (err) {
        console.error(`  Geocode failed for ${key}: ${err}`);
        continue;
      }
    }

    const distKm = Math.round(rep.distance_m / 1000);
    const routeName = `${placeName}_${distKm}km`;

    console.log(`[name]  ${key}  (${rows.length} runs)  →  "${routeName}"`);
    totalUpdated += rows.length;

    if (APPLY) {
      for (const a of rows) {
        await patchRouteName(String(a.id), routeName);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total activities to name: ${totalUpdated}`);
  if (!APPLY) console.log('\nRe-run with --apply to write changes.');
  else console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
