import { json } from '@sveltejs/kit';
import { requireBearer } from '$lib/server/auth.js';
import { getAllActivities } from '$lib/server/directus.js';
import { calculateStreaks, calculatePersonalBests } from '$lib/stats.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request }) => {
  requireBearer(request);
  const activities = await getAllActivities();
  const byYear: Record<string, { runs: number; distance_m: number; moving_time_s: number }> = {};
  for (const a of activities) {
    const y = String(new Date(a.date).getFullYear());
    byYear[y] ??= { runs: 0, distance_m: 0, moving_time_s: 0 };
    byYear[y].runs++;
    byYear[y].distance_m += a.distance_m ?? 0;
    byYear[y].moving_time_s += a.moving_time_s ?? 0;
  }
  return json({
    data: {
      runs: activities.length,
      distance_m: activities.reduce((s, a) => s + (a.distance_m ?? 0), 0),
      moving_time_s: activities.reduce((s, a) => s + (a.moving_time_s ?? 0), 0),
      by_year: byYear,
      streaks: calculateStreaks(activities.map((a) => a.date.slice(0, 10))),
      personal_bests: calculatePersonalBests(activities),
    },
  });
};
