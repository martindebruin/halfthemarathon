import { getAllActivities } from '$lib/server/directus.js';
import { computedSpeed } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  const year = parseInt(params.year, 10);
  if (isNaN(year) || year < 2000 || year > 2100) error(404, 'Not found');

  const all = await getAllActivities();
  const activities = all.filter((a) => new Date(a.date).getFullYear() === year);
  if (activities.length === 0) error(404, `No runs in ${year}`);

  const totalDistM = activities.reduce((s, a) => s + (a.distance_m ?? 0), 0);
  const totalTimS = activities.reduce((s, a) => s + (a.moving_time_s ?? 0), 0);
  const totalElev = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);
  const longest = activities.reduce((best, a) => (a.distance_m ?? 0) > (best.distance_m ?? 0) ? a : best);
  const qualified = activities.filter((a) =>
    (a.distance_m ?? 0) >= 5000 &&
    (a.average_speed ?? computedSpeed(a.distance_m, a.moving_time_s))
  );
  const fastest = qualified.length > 0
    ? qualified.reduce((best, a) => {
        const aSpeed = a.average_speed ?? computedSpeed(a.distance_m, a.moving_time_s) ?? 0;
        const bestSpeed = best.average_speed ?? computedSpeed(best.distance_m, best.moving_time_s) ?? 0;
        return aSpeed > bestSpeed ? a : best;
      })
    : null;

  const allYears = [...new Set(all.map((a) => new Date(a.date).getFullYear()))].sort((a, b) => a - b);
  const idx = allYears.indexOf(year);
  const prevYear = idx > 0 ? allYears[idx - 1] : null;
  const nextYear = idx < allYears.length - 1 ? allYears[idx + 1] : null;

  return { year, activities, totalDistM, totalTimS, totalElev, longest, fastest, prevYear, nextYear };
};
