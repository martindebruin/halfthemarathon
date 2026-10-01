import { error } from '@sveltejs/kit';
import { isLoggedIn, bearerAuthorized } from '$lib/server/auth.js';
import type { RequestHandler } from './$types.js';

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSTHROUGH = ['width', 'height', 'fit', 'quality'];

export const GET: RequestHandler = async ({ params, url, cookies, request }) => {
  if (!isLoggedIn(cookies) && !bearerAuthorized(request)) error(401, 'Unauthorized');
  if (!UUID.test(params.id)) error(404, 'Not found');

  const query = new URLSearchParams();
  for (const key of PASSTHROUGH) {
    const v = url.searchParams.get(key);
    if (v) query.set(key, v);
  }
  const res = await fetch(`${DIRECTUS_URL}/assets/${params.id}?${query}`, {
    headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN ?? ''}` },
  });
  if (!res.ok) error(res.status === 404 || res.status === 403 ? 404 : 502, 'Photo unavailable');

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
    },
  });
};
