import fs from 'fs';
import path from 'path';
import type { RunkeeperActivity, PhotoRecord } from './types.js';
import type { ComputedSplit } from './gpx.js';

export interface GpxComputed {
  polyline: string;
  startLat: number;
  startLng: number;
  splits: ComputedSplit[];
}

function getDirectusUrl(): string {
  return process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
}

function getDirectusToken(): string {
  const token = process.env.DIRECTUS_TOKEN;
  if (!token) throw new Error('DIRECTUS_TOKEN not set');
  return token;
}

async function directusFetch(reqPath: string, options: RequestInit = {}): Promise<unknown> {
  const url = `${getDirectusUrl()}${reqPath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${getDirectusToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Directus ${options.method ?? 'GET'} ${reqPath} failed ${res.status}: ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function upsertActivity(
  rk: RunkeeperActivity,
  gpx: GpxComputed | null
): Promise<string> {
  const distanceM = rk.distanceKm * 1000;
  const averageSpeed =
    rk.averageSpeedKmh != null ? rk.averageSpeedKmh / 3.6 : rk.durationSeconds > 0 ? distanceM / rk.durationSeconds : null;

  const record: Record<string, unknown> = {
    runkeeper_id: rk.activityId,
    source: 'runkeeper',
    date: rk.date.toISOString(),
    name: rk.routeName,
    route_name: rk.routeName || null,
    type: 'Run',
    distance_m: distanceM,
    moving_time_s: rk.durationSeconds,
    elapsed_time_s: rk.durationSeconds,
    total_elevation_gain: rk.climbMeters,
    average_speed: averageSpeed,
    max_speed: null,
    average_cadence: null,
    average_watts: null,
    average_heartrate: rk.averageHeartRate,
    max_heartrate: null,
    summary_polyline: gpx?.polyline ?? null,
    start_lat: gpx?.startLat ?? null,
    start_lng: gpx?.startLng ?? null,
    splits_metric: gpx?.splits.length ? JSON.stringify(gpx.splits) : null,
    laps: null,
    best_efforts: null,
    calories: rk.caloriesBurned,
    description: null,
    notes: rk.notes,
    gear_id: null,
    suffer_score: null,
    pr_count: null,
  };

  const existing = await directusFetch(
    `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(rk.activityId)}&fields=id`
  ) as { data: Array<{ id: string }> };

  if (existing.data.length > 0) {
    const id = existing.data[0].id;
    await directusFetch(`/items/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
    return id;
  }

  const created = await directusFetch('/items/activities', {
    method: 'POST',
    body: JSON.stringify(record),
  }) as { data: { id: string } };

  return created.data.id;
}

export async function upsertPhoto(
  directusActivityId: string,
  photo: PhotoRecord,
  imageBasePath: string
): Promise<void> {
  const filePath = path.join(imageBasePath, photo.imageFileName);
  if (!fs.existsSync(filePath)) return;

  const existing = await directusFetch(
    `/items/photos?filter[original_filename][_eq]=${encodeURIComponent(photo.imageFileName)}&fields=id`
  ) as { data: Array<{ id: string }> };
  if (existing.data.length > 0) return;

  const fileBuffer = fs.readFileSync(filePath);
  const form = new globalThis.FormData();
  form.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), photo.imageFileName);

  const fileUrl = `${getDirectusUrl()}/files`;
  const fileRes = await fetch(fileUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getDirectusToken()}`,
    },
    body: form,
  });

  if (!fileRes.ok) {
    const body = await fileRes.text();
    throw new Error(`File upload failed ${fileRes.status}: ${body}`);
  }

  const fileData = await fileRes.json() as { data: { id: string } };
  const directusFileId = fileData.data.id;

  await directusFetch('/items/photos', {
    method: 'POST',
    body: JSON.stringify({
      activity_id: directusActivityId,
      runkeeper_id: photo.activityId,
      directus_file_id: directusFileId,
      original_filename: photo.imageFileName,
      caption: photo.caption,
      lat: photo.lat,
      lng: photo.lng,
    }),
  });
}
