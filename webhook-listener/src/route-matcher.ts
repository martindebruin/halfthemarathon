import polyline from '@mapbox/polyline';

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const THRESHOLD_M = 120;
const SAMPLE_POINTS = 24;

type Point = [number, number]; // [lat, lng]

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function samplePolyline(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length <= n) return points;
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (points.length - 1));
    result.push(points[idx]);
  }
  return result;
}

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

export function routeSimilarity(a: Point[], b: Point[]): number {
  return (directedAvgHausdorff(a, b) + directedAvgHausdorff(b, a)) / 2;
}

export function sampleEncodedPolyline(encoded: string): Point[] {
  const decoded = polyline.decode(encoded) as Point[];
  return samplePolyline(decoded, SAMPLE_POINTS);
}

interface NamedRouteRow {
  route_name: string;
  summary_polyline: string;
  distance_m: number;
}

async function fetchNamedRoutes(): Promise<NamedRouteRow[]> {
  const url =
    `${DIRECTUS_URL}/items/activities?limit=-1` +
    `&filter[route_name][_nnull]=true` +
    `&fields=route_name,summary_polyline,distance_m`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } });
  if (!res.ok) throw new Error(`Directus fetch failed ${res.status}`);
  const json = await res.json() as { data: NamedRouteRow[] };
  return json.data.filter((r) => r.summary_polyline);
}

async function patchRouteName(activityId: string, routeName: string): Promise<void> {
  const res = await fetch(`${DIRECTUS_URL}/items/activities/${activityId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ route_name: routeName }),
  });
  if (!res.ok) throw new Error(`PATCH route_name failed ${res.status}`);
}

export async function matchAndAssignRoute(
  activityId: string,
  encodedPolyline: string,
  distanceM: number,
): Promise<void> {
  const namedRoutes = await fetchNamedRoutes();
  if (namedRoutes.length === 0) return;

  // Group by route_name: pick longest polyline as representative, track avg distance
  const groups = new Map<string, { repPolyline: string; distances: number[] }>();
  for (const r of namedRoutes) {
    if (!groups.has(r.route_name)) {
      groups.set(r.route_name, { repPolyline: r.summary_polyline, distances: [] });
    }
    const g = groups.get(r.route_name)!;
    if (r.summary_polyline.length > g.repPolyline.length) g.repPolyline = r.summary_polyline;
    g.distances.push(r.distance_m);
  }

  const newSamples = sampleEncodedPolyline(encodedPolyline);
  if (newSamples.length < 3) return;

  let bestRouteName: string | null = null;
  let bestScore = Infinity;

  for (const [name, { repPolyline, distances }] of groups) {
    const avgDistM = distances.reduce((s, d) => s + d, 0) / distances.length;
    if (Math.abs(avgDistM - distanceM) / distanceM > 0.1) continue;

    const candidateSamples = sampleEncodedPolyline(repPolyline);
    if (candidateSamples.length < 3) continue;

    const score = routeSimilarity(newSamples, candidateSamples);
    if (score < bestScore) {
      bestScore = score;
      bestRouteName = name;
    }
  }

  if (bestRouteName !== null && bestScore <= THRESHOLD_M) {
    await patchRouteName(activityId, bestRouteName);
  }
}
