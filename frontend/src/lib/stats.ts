interface ActivityForStats {
  id: string;
  date: string;
  best_efforts: string | null;
  distance_m?: number | null;
  moving_time_s?: number | null;
}

export interface PersonalBest {
  elapsed_time: number;
  activity_id: string;
  date: string;
}

export interface MilestoneConfig {
  label: string;
  unit: 'km' | 'hours' | 'm_elev';
  fun: (value: number) => string;
}

// Sweden N–S = ~1,574 km. Everest = 8,849 m.
export const MILESTONES: MilestoneConfig[] = [
  {
    label: 'Total distance',
    unit: 'km',
    fun: (km) => {
      const swedens = km / 1574;
      if (swedens >= 0.5) return `${swedens.toFixed(1)}× the length of Sweden`;
      return `${(km / 42.195).toFixed(0)} marathons`;
    },
  },
  {
    label: 'Total elevation',
    unit: 'm_elev',
    fun: (m) => {
      const everests = m / 8849;
      return `${everests.toFixed(1)}× the height of Everest`;
    },
  },
  {
    label: 'Total time',
    unit: 'hours',
    fun: (h) => `${h.toFixed(0)} hours — ${(h / 24).toFixed(1)} days on your feet`,
  },
];

// Distance name → key used in PBs map
const BEST_EFFORT_MAP: Record<string, string> = {
  '400m': '400m',
  '1/2 mile': 'half_mile',
  '1k': '1k',
  '1 mile': '1mile',
  '5k': '5k',
  '10k': '10k',
  'Half-Marathon': 'half_marathon',
  'Marathon': 'marathon',
};

// Fallback distance ranges (m) for activities without Strava best_efforts
const DISTANCE_RANGES: Record<string, { min: number; max: number; target: number }> = {
  '1k':            { min: 900,   max: 1200,  target: 1000 },
  '1mile':         { min: 1550,  max: 1750,  target: 1609 },
  '5k':            { min: 4500,  max: 5500,  target: 5000 },
  '10k':           { min: 9000,  max: 11000, target: 10000 },
  'half_marathon': { min: 19000, max: 22500, target: 21097 },
  'marathon':      { min: 40000, max: 44000, target: 42195 },
};

export type PersonalBests = Record<string, PersonalBest | null>;

export function calculatePersonalBests(activities: ActivityForStats[]): PersonalBests {
  const result: PersonalBests = {};
  for (const key of Object.values(BEST_EFFORT_MAP)) result[key] = null;

  for (const a of activities) {
    if (!a.best_efforts) continue;
    let efforts: Array<{ name: string; elapsed_time: number }>;
    try { efforts = JSON.parse(a.best_efforts); } catch { continue; }

    for (const e of efforts) {
      const key = BEST_EFFORT_MAP[e.name];
      if (!key) continue;
      const current = result[key];
      if (!current || e.elapsed_time < current.elapsed_time) {
        result[key] = { elapsed_time: e.elapsed_time, activity_id: a.id, date: a.date };
      }
    }
  }

  // Fallback: estimate PBs from activity distance/time for activities without best_efforts
  for (const a of activities) {
    if (a.best_efforts) continue;
    if (!a.distance_m || !a.moving_time_s) continue;
    for (const [key, range] of Object.entries(DISTANCE_RANGES)) {
      if (a.distance_m < range.min || a.distance_m > range.max) continue;
      const scaled_time = Math.round(a.moving_time_s * (range.target / a.distance_m));
      const current = result[key];
      if (!current || scaled_time < current.elapsed_time) {
        result[key] = { elapsed_time: scaled_time, activity_id: a.id, date: a.date };
      }
    }
  }

  return result;
}

export function calculateStreaks(dates: string[]): { longest: number; current: number } {
  if (dates.length === 0) return { longest: 0, current: 0 };

  const unique = [...new Set(dates)].sort();
  let longest = 1;
  let streak = 1;

  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]);
    const curr = new Date(unique[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / 86400000;
    if (diffDays === 1) {
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 1;
    }
  }

  // Current streak: count back from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = 0;
  for (let i = unique.length - 1; i >= 0; i--) {
    const d = new Date(unique[i]);
    const expected = new Date(today);
    expected.setDate(today.getDate() - current);
    if (d.getTime() === expected.getTime()) {
      current++;
    } else {
      break;
    }
  }

  return { longest, current };
}

interface ActivityForRoutes {
  id: string;
  date: string;
  name: string | null;
  route_name: string | null;
  distance_m: number | null;
  moving_time_s: number | null;
  average_speed: number | null;
  start_lat: number | null;
  start_lng: number | null;
  summary_polyline: string | null;
}

export interface RouteRun {
  id: string;
  date: string;
  time_s: number | null;
  pace_s_km: number | null;
}

export interface RouteStats {
  cluster_key: string;
  display_name: string;
  run_count: number;
  avg_distance_m: number;
  start_lat: number | null;
  start_lng: number | null;
  best_time_s: number | null;
  best_pace_s_km: number | null;
  sample_polyline: string | null;
  runs: RouteRun[];
}

export function computeRoutes(
  activities: ActivityForRoutes[],
  aliases: Array<{ cluster_key: string; display_name: string }>
): RouteStats[] {
  const aliasMap = new Map(aliases.map((a) => [a.cluster_key, a.display_name]));

  type ClusterAcc = {
    run_count: number;
    names: string[];
    distances: number[];
    times: Array<{ id: string; date: string; moving_time_s: number; distance_m: number; speed: number | null; polyline: string | null; start_lat: number | null; start_lng: number | null }>;
    allRuns: Array<{ id: string; date: string; moving_time_s: number | null; speed: number | null }>;
  };

  const clusters = new Map<string, ClusterAcc>();

  for (const a of activities) {
    let cluster_key: string;
    if (a.route_name) {
      cluster_key = `name:${a.route_name}`;
    } else if (a.start_lat != null && a.start_lng != null && a.distance_m != null) {
      const lat = a.start_lat.toFixed(3);
      const lng = a.start_lng.toFixed(3);
      const distKm = Math.round(a.distance_m / 1000);
      cluster_key = `geo:${lat}_${lng}_${distKm}km`;
    } else {
      continue;
    }

    if (!clusters.has(cluster_key)) {
      clusters.set(cluster_key, { run_count: 0, names: [], distances: [], times: [], allRuns: [] });
    }
    const c = clusters.get(cluster_key)!;
    c.run_count++;
    if (a.name) c.names.push(a.name);

    const speed = a.average_speed ?? (a.moving_time_s != null && a.moving_time_s > 0 && a.distance_m != null ? a.distance_m / a.moving_time_s : null);
    c.allRuns.push({ id: a.id, date: a.date, moving_time_s: a.moving_time_s ?? null, speed });

    if (a.distance_m != null) c.distances.push(a.distance_m);
    if (a.moving_time_s != null && a.distance_m != null) {
      c.times.push({ id: a.id, date: a.date, moving_time_s: a.moving_time_s, distance_m: a.distance_m, speed, polyline: a.summary_polyline, start_lat: a.start_lat, start_lng: a.start_lng });
    }
  }

  const results: RouteStats[] = [];

  for (const [cluster_key, acc] of clusters) {
    let display_name: string;
    if (aliasMap.has(cluster_key)) {
      display_name = aliasMap.get(cluster_key)!;
    } else if (cluster_key.startsWith('name:')) {
      display_name = cluster_key.slice(5);
    } else {
      const freq = new Map<string, number>();
      for (const n of acc.names) freq.set(n, (freq.get(n) ?? 0) + 1);
      let best = '';
      let bestCount = 0;
      for (const [n, count] of freq) {
        if (count > bestCount) { bestCount = count; best = n; }
      }
      display_name = best || cluster_key;
    }

    const sortedDist = [...acc.distances].sort((a, b) => a - b);
    const medianDist = sortedDist[Math.floor(sortedDist.length / 2)] ?? 0;
    const avg_distance_m = acc.distances.length > 0
      ? Math.round(acc.distances.reduce((s, d) => s + d, 0) / acc.distances.length)
      : 0;

    const sameDistTimes = medianDist > 0
      ? acc.times.filter((t) => Math.abs(t.distance_m - medianDist) / medianDist <= 0.1)
      : acc.times;
    const best_time_s = sameDistTimes.length > 0
      ? Math.min(...sameDistTimes.map((t) => t.moving_time_s))
      : null;

    const speedRuns = acc.times.filter((t) => t.speed != null && t.speed > 0);
    const bestSpeed = speedRuns.length > 0 ? Math.max(...speedRuns.map((t) => t.speed!)) : null;
    const best_pace_s_km = bestSpeed != null ? Math.round(1000 / bestSpeed) : null;

    // sample_polyline + start coords: from the fastest run
    const bestSpeedRun = speedRuns.length > 0
      ? speedRuns.reduce((best, t) => (t.speed! > best.speed! ? t : best))
      : null;
    const sample_polyline = bestSpeedRun?.polyline ?? null;
    const start_lat = bestSpeedRun?.start_lat ?? acc.times[0]?.start_lat ?? null;
    const start_lng = bestSpeedRun?.start_lng ?? acc.times[0]?.start_lng ?? null;

    // runs: all activities in cluster, sorted date descending
    const runs: RouteRun[] = acc.allRuns
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        id: String(r.id),
        date: r.date,
        time_s: r.moving_time_s,
        pace_s_km: r.speed != null && r.speed > 0 ? Math.round(1000 / r.speed) : null,
      }));

    results.push({ cluster_key, display_name, run_count: acc.run_count, avg_distance_m, start_lat, start_lng, best_time_s, best_pace_s_km, sample_polyline, runs });
  }

  return results.sort((a, b) => b.run_count - a.run_count);
}
