import { json } from '@sveltejs/kit';
import { requireBearer } from '$lib/server/auth.js';
import { parsePaging, toRunSummary } from '$lib/server/api.js';
import { getAllActivities } from '$lib/server/directus.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url }) => {
  requireBearer(request);
  const { limit, offset, year } = parsePaging(url.searchParams);
  const all = await getAllActivities();
  const matching = year == null ? all : all.filter((a) => new Date(a.date).getFullYear() === year);
  return json({
    data: matching.slice(offset, offset + limit).map(toRunSummary),
    meta: { total: matching.length, limit, offset },
  });
};
