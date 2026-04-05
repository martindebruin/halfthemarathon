import { upsertRouteAlias } from '$lib/server/directus.js';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON');
  }
  const { cluster_key, display_name } = body as Record<string, unknown>;
  if (typeof cluster_key !== 'string' || !cluster_key ||
      typeof display_name !== 'string' || !display_name.trim()) {
    throw error(400, 'cluster_key and display_name are required');
  }
  await upsertRouteAlias(cluster_key, display_name.trim());
  return json({ ok: true });
};
