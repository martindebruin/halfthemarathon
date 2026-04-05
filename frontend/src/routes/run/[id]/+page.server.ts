import { getActivity, getActivityPhotos, getAllActivities, getRouteAliases } from '$lib/server/directus.js';
import { computeRoutes } from '$lib/stats.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  try {
    const [activity, photos, allActivities, aliases] = await Promise.all([
      getActivity(params.id),
      getActivityPhotos(params.id),
      getAllActivities(),
      getRouteAliases(),
    ]);
    const routes = computeRoutes(allActivities, aliases);
    const routeContext = routes.find((r) => r.runs.some((run) => run.id === params.id)) ?? null;
    return { activity, photos, routeContext };
  } catch {
    error(404, 'Activity not found');
  }
};
