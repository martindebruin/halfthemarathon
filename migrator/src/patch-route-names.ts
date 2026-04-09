/**
 * patch-route-names.ts
 *
 * Merges fragmented route clusters by setting route_name on activities whose
 * computed cluster_key (same logic as computeRoutes in stats.ts) belongs to
 * a known duplicate cluster.
 *
 * For named clusters: source geo-clusters are updated to use the existing name.
 * For geo-only clusters: all activities are given a shared auto-generated name
 *   so they appear as one route row. Rename afterwards via the admin UI.
 *
 * Usage:
 *   npm run patch-route-names           # dry run (no writes)
 *   npm run patch-route-names -- --apply  # apply changes
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
// Merge config — generated from find-similar-routes output.
//
// Each entry: activities whose current cluster_key is in `sourceClusters`
// will have route_name set to `targetRouteName`.
//
// For named groups (targetRouteName already exists as a route_name in the DB)
// only the geo-cluster activities are listed in sourceClusters.
//
// For geo-only groups all clusters are listed; activities currently have
// route_name = null and will receive the auto-generated targetRouteName.
// ---------------------------------------------------------------------------

interface MergeGroup {
  targetRouteName: string;
  sourceClusters: string[]; // cluster_keys to update
}

const MERGE_GROUPS: MergeGroup[] = [
  // ── Named groups ─────────────────────────────────────────────────────────
  {
    targetRouteName: 'Lundby_LötRygg_8km',
    sourceClusters: [
      'geo:59.368_17.087_8km',
      'geo:59.368_17.089_8km',
      'name:Löpning vid lunch',
      'geo:59.368_17.088_8km',
    ],
  },
  {
    targetRouteName: 'Lundby_RoundNBack_5km',
    sourceClusters: [
      'geo:59.367_17.088_5km',
      'geo:59.367_17.087_5km',
      'geo:59.368_17.088_5km',
      'geo:59.368_17.087_5km',
    ],
  },
  {
    targetRouteName: 'Knivsta_Noor_5k',
    sourceClusters: [
      'geo:59.723_17.793_5km',
      'geo:59.723_17.794_5km',
      'geo:59.722_17.793_5km',
    ],
  },
  {
    targetRouteName: '10KM_Tallkrogen',
    sourceClusters: ['geo:59.267_18.092_10km'],
  },
  {
    targetRouteName: 'KNIVSTA_10KM',
    sourceClusters: ['geo:59.723_17.793_10km'],
  },
  {
    targetRouteName: 'Knivsta_Vassunda_8km',
    sourceClusters: ['geo:59.723_17.792_8km'],
  },
  {
    targetRouteName: '10km hemma',
    sourceClusters: [
      'geo:59.367_17.088_10km',
      'geo:59.368_17.088_10km',
    ],
  },

  // ── Geo-only groups (auto-named; rename via admin UI afterwards) ──────────
  {
    // Lundby long run (21 km)
    targetRouteName: 'Lundby_21km',
    sourceClusters: [
      'geo:59.368_17.089_21km',
      'geo:59.368_17.088_21km',
    ],
  },
  {
    // Lundby short loop (3 km)
    targetRouteName: 'Lundby_3km',
    sourceClusters: [
      'geo:59.367_17.088_3km',
      'geo:59.368_17.087_3km',
      'geo:59.367_17.087_3km',
      'geo:59.367_17.085_3km',
    ],
  },
  {
    // Lundby medium run (8 km, different route from Lundby_LötRygg_8km)
    targetRouteName: 'Lundby_8km',
    sourceClusters: [
      'geo:59.367_17.088_8km',
      'geo:59.367_17.087_8km',
    ],
  },
  {
    // Lundby 6 km
    targetRouteName: 'Lundby_6km',
    sourceClusters: [
      'geo:59.367_17.088_6km',
      'geo:59.367_17.087_6km',
      'geo:59.368_17.087_6km',
    ],
  },
  {
    // Tallkrogen 3 km
    targetRouteName: 'Tallkrogen_3km',
    sourceClusters: [
      'geo:59.267_18.092_3km',
      'geo:59.266_18.092_3km',
      'geo:59.266_18.093_3km',
    ],
  },
  {
    // Tallkrogen 5 km
    targetRouteName: 'Tallkrogen_5km',
    sourceClusters: [
      'geo:59.267_18.092_5km',
      'geo:59.266_18.092_5km',
      'geo:59.266_18.093_5km',
    ],
  },
  {
    // Tallkrogen 6 km
    targetRouteName: 'Tallkrogen_6km',
    sourceClusters: [
      'geo:59.267_18.092_6km',
      'geo:59.266_18.093_6km',
      'geo:59.266_18.092_6km',
    ],
  },
  {
    // Halmstad 5 km (route A — starts around 56.658/12.809)
    targetRouteName: 'Halmstad_5km',
    sourceClusters: [
      'geo:56.658_12.809_5km',
      'geo:56.651_12.811_5km',
      'geo:56.657_12.809_5km',
      'geo:56.658_12.810_5km',
    ],
  },
  {
    // Halmstad 3 km
    targetRouteName: 'Halmstad_3km',
    sourceClusters: [
      'geo:56.658_12.808_3km',
      'geo:56.658_12.809_3km',
      'geo:56.656_12.809_3km',
    ],
  },
  {
    // Halmstad 6 km
    targetRouteName: 'Halmstad_6km',
    sourceClusters: [
      'geo:56.658_12.809_6km',
      'geo:56.658_12.808_6km',
      'geo:56.657_12.809_6km',
      'geo:56.657_12.810_6km',
    ],
  },
  {
    // Halmstad 10 km
    targetRouteName: 'Halmstad_10km',
    sourceClusters: [
      'geo:56.657_12.809_10km',
      'geo:56.659_12.808_10km',
      'geo:56.658_12.809_10km',
    ],
  },
  {
    // Halmstad 5 km (route B — starts around 56.658/12.808, different loop)
    targetRouteName: 'Halmstad_5km_B',
    sourceClusters: [
      'geo:56.658_12.808_5km',
      'geo:56.659_12.808_5km',
      'geo:56.660_12.808_5km',
    ],
  },
  {
    // Halmstad 4 km
    // NOTE: geo:56.644_12.792_4km intentionally excluded — ~1.5 km away,
    //       likely a different location; similarity score 111–118m was borderline.
    targetRouteName: 'Halmstad_4km',
    sourceClusters: [
      'geo:56.658_12.808_4km',
      'geo:56.658_12.809_4km',
      'geo:56.658_12.810_4km',
      'geo:56.657_12.809_4km',
      'geo:56.659_12.808_4km',
      'geo:56.659_12.807_4km',
    ],
  },
  {
    // Knivsta 3 km
    targetRouteName: 'Knivsta_3km',
    sourceClusters: [
      'geo:59.723_17.794_3km',
      'geo:59.724_17.793_3km',
      'geo:59.722_17.795_3km',
    ],
  },

  // ── Second-pass merges (found at 250m threshold) ──────────────────────────
  {
    // User confirmed Lundby_8km is the same route as Lundby_LötRygg_8km
    targetRouteName: 'Lundby_LötRygg_8km',
    sourceClusters: ['name:Lundby_8km'],
  },
  {
    // Remaining 21km Lundby cluster missed in first pass
    targetRouteName: 'Lundby_21km',
    sourceClusters: ['geo:59.367_17.088_21km'],
  },
  {
    // Two more 10km Lundby clusters
    targetRouteName: '10km hemma',
    sourceClusters: [
      'geo:59.367_17.087_10km',
      'geo:59.368_17.087_10km',
    ],
  },
  {
    // Additional Halmstad 3km cluster (score 123m, just above first-pass threshold)
    targetRouteName: 'Halmstad_3km',
    sourceClusters: ['geo:56.657_12.809_3km'],
  },
  {
    // Second distinct Halmstad 3km route (different loop, slightly north)
    targetRouteName: 'Halmstad_3km_B',
    sourceClusters: [
      'geo:56.659_12.809_3km',
      'geo:56.660_12.808_3km',
    ],
  },
  {
    // Previously excluded outlier — polyline similarity 111m confirms same route
    targetRouteName: 'Halmstad_4km',
    sourceClusters: ['geo:56.644_12.792_4km'],
  },

  // ── Third-pass: Tallkrogen merge + Olofsdal → Halmstad renames ───────────
  {
    // Kryddhyllan_10km polyline similarity 347m to 10KM_Tallkrogen (same route, same area)
    targetRouteName: '10KM_Tallkrogen',
    sourceClusters: ['name:Kryddhyllan_10km'],
  },
  {
    // All Olofsdal_* routes are in Halmstad (Olofsdal is a Halmstad neighbourhood)
    targetRouteName: 'Halmstad_1km',
    sourceClusters: ['name:Olofsdal_1km'],
  },
  {
    targetRouteName: 'Halmstad_2km',
    sourceClusters: ['name:Olofsdal_2km'],
  },
  {
    // Halmstad_6km already exists (different route); this is B variant
    targetRouteName: 'Halmstad_6km_B',
    sourceClusters: ['name:Olofsdal_6km'],
  },
  {
    targetRouteName: 'Halmstad_8km',
    sourceClusters: ['name:Olofsdal_8km'],
  },
  {
    // Halmstad_10km already exists (different route); this is B variant
    targetRouteName: 'Halmstad_10km_B',
    sourceClusters: ['name:Olofsdal_10km'],
  },
  {
    targetRouteName: 'Halmstad_11km',
    sourceClusters: ['name:Olofsdal_11km'],
  },
  {
    targetRouteName: 'Halmstad_15km',
    sourceClusters: ['name:Olofsdal_15km'],
  },
  {
    targetRouteName: 'Halmstad_16km',
    sourceClusters: ['name:Olofsdal_16km'],
  },

  // ── Fourth-pass: Knivsta_8km → Knivsta_Vassunda_8km ──────────────────────
  {
    // Auto-namer named this "Knivsta_8km"; same route as the existing Vassunda cluster
    targetRouteName: 'Knivsta_Vassunda_8km',
    sourceClusters: ['name:Knivsta_8km'],
  },
];

// ---------------------------------------------------------------------------
// Directus helpers
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  route_name: string | null;
  distance_m: number | null;
  start_lat: number | null;
  start_lng: number | null;
}

async function fetchActivities(): Promise<ActivityRow[]> {
  const url = `${DIRECTUS_URL}/items/activities?limit=-1&fields=id,route_name,distance_m,start_lat,start_lng`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: ActivityRow[] };
  return json.data;
}

async function patchRouteName(id: string, routeName: string): Promise<void> {
  const res = await fetch(`${DIRECTUS_URL}/items/activities/${id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ route_name: routeName }),
  });
  if (!res.ok) throw new Error(`PATCH ${id} failed ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Cluster key — mirrors computeRoutes in stats.ts
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!APPLY) {
    console.log('=== DRY RUN — pass --apply to write changes ===\n');
  }

  console.log(`Fetching activities from ${DIRECTUS_URL} ...`);
  const activities = await fetchActivities();
  console.log(`  ${activities.length} activities\n`);

  // Build cluster_key index
  const byKey = new Map<string, ActivityRow[]>();
  for (const a of activities) {
    const key = clusterKey(a);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
  }

  let totalUpdated = 0;
  let totalAlready = 0;

  for (const group of MERGE_GROUPS) {
    const toUpdate: ActivityRow[] = [];
    const alreadyCorrect: ActivityRow[] = [];

    for (const ck of group.sourceClusters) {
      const rows = byKey.get(ck) ?? [];
      for (const row of rows) {
        if (row.route_name === group.targetRouteName) {
          alreadyCorrect.push(row);
        } else {
          toUpdate.push(row);
        }
      }
    }

    totalAlready += alreadyCorrect.length;
    totalUpdated += toUpdate.length;

    if (toUpdate.length === 0) {
      console.log(`[skip]  "${group.targetRouteName}" — nothing to update (${alreadyCorrect.length} already correct)`);
      continue;
    }

    console.log(`[merge] "${group.targetRouteName}" — ${toUpdate.length} to update, ${alreadyCorrect.length} already correct`);
    for (const a of toUpdate) {
      const oldKey = clusterKey(a) ?? '(no key)';
      console.log(`        ${String(a.id).slice(0, 8)}  ${oldKey}  →  route_name="${group.targetRouteName}"`);
      if (APPLY) {
        await patchRouteName(a.id, group.targetRouteName);
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total to update: ${totalUpdated}  |  already correct: ${totalAlready}`);
  if (!APPLY) {
    console.log('\nRe-run with --apply to write changes.');
  } else {
    console.log('\nDone.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
