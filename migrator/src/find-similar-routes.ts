/**
 * find-similar-routes.ts
 *
 * Fetches all activities from Directus, groups them by the same cluster_key
 * logic used in frontend/src/lib/stats.ts#computeRoutes, then compares
 * representative polylines across clusters to identify routes that are
 * physically the same but listed separately.
 *
 * Usage:
 *   npm run find-similar-routes
 *   npm run find-similar-routes -- --threshold 150   # max avg deviation in metres (default: 120)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import polyline from '@mapbox/polyline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';

const argIdx = process.argv.indexOf('--threshold');
const THRESHOLD_M = argIdx !== -1 ? parseInt(process.argv[argIdx + 1], 10) : 120;
const VERBOSE = process.argv.includes('--verbose');
const SAMPLE_POINTS = 24; // evenly-spaced samples per polyline

// ---------------------------------------------------------------------------
// Directus fetch
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  name: string | null;
  route_name: string | null;
  distance_m: number | null;
  start_lat: number | null;
  start_lng: number | null;
  summary_polyline: string | null;
}

async function fetchActivities(): Promise<ActivityRow[]> {
  const url = `${DIRECTUS_URL}/items/activities?limit=-1&fields=id,name,route_name,distance_m,start_lat,start_lng,summary_polyline`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Directus fetch failed ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: ActivityRow[] };
  return json.data;
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
// Geometry helpers
// ---------------------------------------------------------------------------

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Point = [number, number]; // [lat, lng]

/**
 * Sample `n` evenly-spaced points along a polyline (by index, not arc-length).
 */
function samplePolyline(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length <= n) return points;
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (points.length - 1));
    result.push(points[idx]);
  }
  return result;
}

/**
 * Directed average Hausdorff: for each point in `a`, find the min distance
 * to any point in `b`, then return the average of those.
 */
function directedAvgHausdorff(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let total = 0;
  for (const [la, lna] of a) {
    let minD = Infinity;
    for (const [lb, lnb] of b) {
      const d = haversineM(la, lna, lb, lnb);
      if (d < minD) minD = d;
    }
    total += minD;
  }
  return total / a.length;
}

/**
 * Symmetric similarity score: average of both directed Hausdorff distances.
 */
function routeSimilarity(a: Point[], b: Point[]): number {
  return (directedAvgHausdorff(a, b) + directedAvgHausdorff(b, a)) / 2;
}

// ---------------------------------------------------------------------------
// Union-Find for grouping similar clusters
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<string, string> = new Map();

  find(x: string): string {
    if (!this.parent.has(x)) return x;
    const root = this.find(this.parent.get(x)!);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Fetching activities from ${DIRECTUS_URL} ...`);
  const activities = await fetchActivities();
  console.log(`  ${activities.length} activities fetched`);

  // Group by cluster_key
  const clusters = new Map<string, ActivityRow[]>();
  for (const a of activities) {
    const key = clusterKey(a);
    if (!key) continue;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(a);
  }
  console.log(`  ${clusters.size} unique cluster keys\n`);

  // For each cluster, pick a representative polyline (prefer one with most points)
  interface ClusterInfo {
    key: string;
    runCount: number;
    avgDistM: number;
    repPolyline: string;
    repStart: Point;
    samples: Point[];
    displayName: string;
  }

  const clusterInfos: ClusterInfo[] = [];
  for (const [key, rows] of clusters) {
    const withPoly = rows.filter((r) => r.summary_polyline);
    if (withPoly.length === 0) continue;

    // Pick the activity with the longest polyline string (most detail)
    const rep = withPoly.reduce((best, r) =>
      (r.summary_polyline!.length > best.summary_polyline!.length ? r : best)
    );

    const decoded = polyline.decode(rep.summary_polyline!) as Point[];
    if (decoded.length < 3) continue;

    const samples = samplePolyline(decoded, SAMPLE_POINTS);
    const avgDistM = rows
      .filter((r) => r.distance_m != null)
      .reduce((s, r) => s + r.distance_m!, 0) / Math.max(rows.filter((r) => r.distance_m != null).length, 1);

    const displayName = key.startsWith('name:') ? key.slice(5) : key;

    clusterInfos.push({
      key,
      runCount: rows.length,
      avgDistM,
      repPolyline: rep.summary_polyline!,
      repStart: decoded[0],
      samples,
      displayName,
    });
  }

  console.log(`  ${clusterInfos.length} clusters with usable polylines`);
  console.log(`  Similarity threshold: ${THRESHOLD_M}m\n`);

  // Compare all pairs — only bother if start points are within ~2km
  const START_FILTER_M = 2000;
  const uf = new UnionFind();
  const similarPairs: Array<{ a: string; b: string; score: number }> = [];
  const allCandidatePairs: Array<{ a: string; b: string; score: number }> = [];

  for (let i = 0; i < clusterInfos.length; i++) {
    for (let j = i + 1; j < clusterInfos.length; j++) {
      const ci = clusterInfos[i];
      const cj = clusterInfos[j];

      // Fast pre-filter: start points must be close
      const startDist = haversineM(ci.repStart[0], ci.repStart[1], cj.repStart[0], cj.repStart[1]);
      if (startDist > START_FILTER_M) continue;

      // Distance must be within 200m absolute
      const distDiff = Math.abs(ci.avgDistM - cj.avgDistM);
      if (distDiff > 200) continue;

      const score = routeSimilarity(ci.samples, cj.samples);
      const rounded = Math.round(score);
      allCandidatePairs.push({ a: ci.key, b: cj.key, score: rounded });
      if (score <= THRESHOLD_M) {
        uf.union(ci.key, cj.key);
        similarPairs.push({ a: ci.key, b: cj.key, score: rounded });
      }
    }
  }

  if (VERBOSE || similarPairs.length === 0) {
    const top = [...allCandidatePairs].sort((a, b) => a.score - b.score).slice(0, 40);
    console.log(`Top closest pairs (by avg polyline deviation):`);
    for (const p of top) {
      const aName = clusterInfos.find((c) => c.key === p.a)?.displayName ?? p.a;
      const bName = clusterInfos.find((c) => c.key === p.b)?.displayName ?? p.b;
      const aRuns = clusterInfos.find((c) => c.key === p.a)?.runCount ?? 0;
      const bRuns = clusterInfos.find((c) => c.key === p.b)?.runCount ?? 0;
      console.log(`  ${p.score.toString().padStart(5)}m  [${aRuns}] "${aName}"  ↔  [${bRuns}] "${bName}"`);
    }
    console.log();
  }

  if (similarPairs.length === 0) {
    console.log(`No pairs within ${THRESHOLD_M}m threshold. Try --threshold <higher value>.`);
    return;
  }

  // Group clusters by their union root
  const groups = new Map<string, ClusterInfo[]>();
  for (const ci of clusterInfos) {
    const root = uf.find(ci.key);
    if (root === ci.key && !similarPairs.some((p) => p.a === ci.key || p.b === ci.key)) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ci);
  }

  // Print results
  console.log(`Found ${groups.size} route groups with similar routes:\n`);
  console.log('='.repeat(72));

  let groupNum = 0;
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    groupNum++;
    const totalRuns = members.reduce((s, c) => s + c.runCount, 0);
    console.log(`\nGroup ${groupNum} — ${totalRuns} runs total across ${members.length} clusters`);
    console.log('-'.repeat(72));
    for (const m of members.sort((a, b) => b.runCount - a.runCount)) {
      const distKm = (m.avgDistM / 1000).toFixed(1);
      console.log(`  [${m.runCount.toString().padStart(3)} runs | ~${distKm} km]  ${m.displayName}`);
      console.log(`    cluster_key: ${m.key}`);
    }
    // Show pair scores within this group
    const groupKeys = new Set(members.map((m) => m.key));
    const groupPairs = similarPairs.filter((p) => groupKeys.has(p.a) && groupKeys.has(p.b));
    if (groupPairs.length > 0) {
      console.log('  Similarity scores (avg deviation):');
      for (const p of groupPairs) {
        const aName = members.find((m) => m.key === p.a)?.displayName ?? p.a;
        const bName = members.find((m) => m.key === p.b)?.displayName ?? p.b;
        console.log(`    "${aName}" ↔ "${bName}": ${p.score}m`);
      }
    }
    console.log();
    console.log('  To merge: update route_name in Directus for all activities in the smaller');
    console.log(`  cluster(s) to match the larger cluster's route_name, or use the admin`);
    console.log(`  rename UI to give both clusters the same display name.`);
  }

  console.log('\n' + '='.repeat(72));
  console.log(`\nTotal similar pairs: ${similarPairs.length}`);
  console.log(`Run with --threshold=<metres> to adjust sensitivity (current: ${THRESHOLD_M}m)`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
