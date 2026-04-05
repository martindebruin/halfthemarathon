import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ cookies }) => {
  cookies.delete('admin_session', { path: '/' });
  return json({ ok: true });
};
