function getDirectusUrl(): string {
  return process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
}

function getToken(): string {
  const t = process.env.DIRECTUS_TOKEN;
  if (!t) throw new Error('DIRECTUS_TOKEN not set');
  return t;
}

async function directusFetch(reqPath: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${getDirectusUrl()}${reqPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getToken()}`,
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

export interface AppRunPayload {
  app_run_id: string;
  started_at: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s?: number | null;
  avg_speed_ms?: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  summary_polyline?: string | null;
  splits?: unknown[];
}

export async function upsertAppRun(payload: AppRunPayload): Promise<string> {
  const idKey = `app:${payload.app_run_id}`;
  const record = {
    runkeeper_id: idKey,
    source: 'app',
    type: 'Run',
    date: payload.started_at,
    distance_m: payload.distance_m,
    moving_time_s: payload.moving_time_s,
    elapsed_time_s: payload.elapsed_time_s ?? null,
    average_speed: payload.avg_speed_ms ?? null,
    start_lat: payload.start_lat ?? null,
    start_lng: payload.start_lng ?? null,
    summary_polyline: payload.summary_polyline ?? null,
    splits_metric: payload.splits ? JSON.stringify(payload.splits) : null,
  };

  const existing = await directusFetch(
    `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(idKey)}&fields=id`
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

export async function patchActivityName(id: string, name: string): Promise<void> {
  await directusFetch(`/items/activities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function uploadPhotoForAppRun(
  appRunId: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const idKey = `app:${appRunId}`;

  const existing = await directusFetch(
    `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(idKey)}&fields=id`,
  ) as { data: Array<{ id: string }> };
  if (existing.data.length === 0) return null;
  const activityId = existing.data[0].id;

  const filename = `app-run-${appRunId}.jpg`;
  const form = new globalThis.FormData();
  form.append('file', new Blob([fileBuffer.buffer as ArrayBuffer], { type: mimeType }), filename);
  const fileRes = await fetch(`${getDirectusUrl()}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!fileRes.ok) throw new Error(`File upload failed ${fileRes.status}`);
  const fileData = await fileRes.json() as { data: { id: string } };
  const fileId = fileData.data.id;

  await directusFetch('/items/photos', {
    method: 'POST',
    body: JSON.stringify({
      activity_id: activityId,
      directus_file_id: fileId,
      original_filename: filename,
      caption: null,
      lat: null,
      lng: null,
    }),
  });

  const publicUrl = process.env.DIRECTUS_PUBLIC_URL ?? 'https://cms-run.martindebruin.se';
  return `${publicUrl}/assets/${fileId}?width=240&height=144&fit=cover&quality=70`;
}
