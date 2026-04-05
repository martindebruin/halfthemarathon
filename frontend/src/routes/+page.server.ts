import { getAllActivities } from '$lib/server/directus.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  const activities = await getAllActivities();
  return { activities };
};
