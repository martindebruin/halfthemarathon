import type { Cookies } from '@sveltejs/kit';

export function isAdmin(cookies: Cookies): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  const session = cookies.get('admin_session');
  return !!(adminToken && session === adminToken);
}
