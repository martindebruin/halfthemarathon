import { getAllActivities, getRecords, getRouteAliases } from '$lib/server/directus.js';
import { calculateStreaks, calculatePersonalBests, computeRoutes, MILESTONES } from '$lib/stats.js';
import type { PageServerLoad } from './$types.js';

interface WeekStat {
  year: number;
  week: number;
  run_count: number;
  total_dist_m: number;
  total_time_s: number;
  avg_pace_s_km: number | null;
  avg_hr: number | null;
  long_run_m: number;
}

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export const load: PageServerLoad = async () => {
  const [activities, records, aliases] = await Promise.all([
    getAllActivities(),
    getRecords(),
    getRouteAliases(),
  ]);

  const weekMap = new Map<string, {
    year: number; week: number; run_count: number;
    total_dist_m: number; total_time_s: number;
    hr_sum: number; hr_count: number; long_run_m: number;
  }>();

  for (const a of activities) {
    const { year, week } = getISOWeek(new Date(a.date));
    const key = `${year}-${String(week).padStart(2, '0')}`;
    if (!weekMap.has(key)) {
      weekMap.set(key, { year, week, run_count: 0, total_dist_m: 0, total_time_s: 0, hr_sum: 0, hr_count: 0, long_run_m: 0 });
    }
    const w = weekMap.get(key)!;
    w.run_count++;
    w.total_dist_m += a.distance_m ?? 0;
    w.total_time_s += a.moving_time_s ?? 0;
    if (a.average_heartrate) { w.hr_sum += a.average_heartrate; w.hr_count++; }
    if ((a.distance_m ?? 0) > w.long_run_m) w.long_run_m = a.distance_m ?? 0;
  }

  const weekly: WeekStat[] = Array.from(weekMap.values())
    .sort((a, b) => b.year - a.year || b.week - a.week)
    .map((w) => ({
      year: w.year,
      week: w.week,
      run_count: w.run_count,
      total_dist_m: w.total_dist_m,
      total_time_s: w.total_time_s,
      avg_pace_s_km: w.total_dist_m > 0 ? w.total_time_s / (w.total_dist_m / 1000) : null,
      avg_hr: w.hr_count > 0 ? Math.round(w.hr_sum / w.hr_count) : null,
      long_run_m: w.long_run_m,
    }));

  // Build daily map: "YYYY-MM-DD" → { total_km: number, first_activity_id: string }
  const dailyMap = new Map<string, { total_km: number; first_activity_id: string }>();
  for (const a of activities) {
    const day = a.date.slice(0, 10);
    if (!dailyMap.has(day)) {
      dailyMap.set(day, { total_km: 0, first_activity_id: a.id });
    }
    dailyMap.get(day)!.total_km += (a.distance_m ?? 0) / 1000;
  }
  const daily = Object.fromEntries(dailyMap);

  const availableYears = [...new Set(activities.map((a) => new Date(a.date).getFullYear()))].sort((a, b) => b - a);

  // Lifetime milestones
  const totalKm = activities.reduce((s, a) => s + (a.distance_m ?? 0) / 1000, 0);
  const totalHours = activities.reduce((s, a) => s + (a.moving_time_s ?? 0) / 3600, 0);
  const totalElevM = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);

  const milestones = MILESTONES.map((m) => {
    const value = m.unit === 'km' ? totalKm : m.unit === 'hours' ? totalHours : totalElevM;
    return { label: m.label, value: Math.round(value), fun: m.fun(value) };
  });

  // Streaks
  const streaks = calculateStreaks(activities.map((a) => a.date.slice(0, 10)));

  // Personal bests — dynamically calculated
  const personalBests = calculatePersonalBests(activities);

  // Year-over-year
  const yoyMap = new Map<number, { dist_km: number; runs: number; elev: number }>();
  for (const a of activities) {
    const y = new Date(a.date).getFullYear();
    if (!yoyMap.has(y)) yoyMap.set(y, { dist_km: 0, runs: 0, elev: 0 });
    const r = yoyMap.get(y)!;
    r.dist_km += (a.distance_m ?? 0) / 1000;
    r.runs += 1;
    r.elev += a.total_elevation_gain ?? 0;
  }
  const yoy = Array.from(yoyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, d]) => ({ year, dist_km: Math.round(d.dist_km), runs: d.runs, elev: Math.round(d.elev) }));

  // Pace trends — average pace (s/km) per calendar month
  const paceMap = new Map<string, { sum_s_km: number; count: number }>();
  for (const a of activities) {
    if (!a.distance_m || a.distance_m < 3000) continue;
    const effectiveSpeed = a.average_speed ?? (a.moving_time_s ? a.distance_m / a.moving_time_s : null);
    if (!effectiveSpeed) continue;
    const month = a.date.slice(0, 7); // YYYY-MM
    if (!paceMap.has(month)) paceMap.set(month, { sum_s_km: 0, count: 0 });
    const p = paceMap.get(month)!;
    p.sum_s_km += 1000 / effectiveSpeed; // s per km
    p.count++;
  }
  const paceTrends = Array.from(paceMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({ month, avg_s_km: Math.round(d.sum_s_km / d.count) }));

  // Fastest pace activity — compute from activities since average_speed may be null for Runkeeper data
  const fastestPaceActivity = activities
    .filter((a) => (a.distance_m ?? 0) >= 5000 && a.moving_time_s)
    .reduce((best: (typeof activities[0] & { average_speed: number }) | null, a) => {
      const speed = a.average_speed ?? a.distance_m! / a.moving_time_s!;
      if (!best || speed > best.average_speed) return { ...a, average_speed: speed };
      return best;
    }, null);

  const routes = computeRoutes(activities, aliases);

  return {
    weekly,
    records: { ...records, fastestPaceActivity },
    daily,
    availableYears,
    milestones,
    streaks,
    personalBests,
    yoy,
    paceTrends,
    routes,
  };
};
