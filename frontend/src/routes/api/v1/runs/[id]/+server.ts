import { json, error } from '@sveltejs/kit';
import { requireBearer } from '$lib/server/auth.js';
import { parseRunPatch, toRunSummary } from '$lib/server/api.js';
import { getActivity, getActivityPhotos, updateActivity, deleteActivity } from '$lib/server/directus.js';
import { parseSplits, photoUrl } from '$lib/utils.js';
import type { RequestHandler } from './$types.js';

function validId(id: string): string {
  if (!/^\d+$/.test(id)) error(404, 'Run not found');
  return id;
}

async function loadRun(id: string) {
  try {
    return await getActivity(id);
  } catch {
    error(404, 'Run not found');
  }
}

export const GET: RequestHandler = async ({ request, params }) => {
  requireBearer(request);
  const id = validId(params.id);
  const [activity, photos] = await Promise.all([loadRun(id), getActivityPhotos(id).catch(() => [])]);
  return json({
    data: {
      ...toRunSummary({ ...activity, photos: [] }),
      elapsed_time_s: activity.elapsed_time_s,
      max_speed: activity.max_speed,
      max_heartrate: activity.max_heartrate,
      notes: activity.notes,
      summary_polyline: activity.summary_polyline,
      splits: parseSplits(activity.splits_metric),
      photos: photos.flatMap((p) =>
        p.directus_file_id ? [{ id: String(p.id), url: photoUrl(p.directus_file_id), caption: p.caption }] : []),
    },
  });
};

export const PATCH: RequestHandler = async ({ request, params }) => {
  requireBearer(request);
  const id = validId(params.id);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid JSON');
  }
  const parsed = parseRunPatch(body);
  if (!parsed.ok) error(400, parsed.error);
  await loadRun(id);
  const updated = await updateActivity(id, parsed.patch);
  return json({ data: toRunSummary({ ...updated, photos: [] }) });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  requireBearer(request);
  const id = validId(params.id);
  await loadRun(id);
  await deleteActivity(id);
  return new Response(null, { status: 204 });
};
