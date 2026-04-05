import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) throw error(503, 'Admin not configured');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON');
  }

  const { token } = body as Record<string, unknown>;
  if (typeof token !== 'string' || token !== adminToken) {
    throw error(401, 'Invalid token');
  }

  cookies.set('admin_session', adminToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return json({ ok: true });
};
