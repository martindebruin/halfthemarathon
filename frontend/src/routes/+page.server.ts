import { getAllActivities } from '$lib/server/directus.js';
import { requireLogin } from '$lib/server/auth.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ cookies, url }) => {
  requireLogin(cookies, url);
  const activities = await getAllActivities();
  return { activities };
};
