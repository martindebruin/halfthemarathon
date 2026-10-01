import { isLoggedIn, requireLogin } from '$lib/server/auth.js';
import type { LayoutServerLoad } from './$types.js';

export const load: LayoutServerLoad = async ({ cookies, url }) => {
  if (url.pathname !== '/login') requireLogin(cookies, url);
  return { loggedIn: isLoggedIn(cookies) };
};
