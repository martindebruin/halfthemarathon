import { computedSpeed, photoUrl } from '$lib/utils.js';
import type { Activity } from './directus.js';

export interface RunPatch {
  name?: string;
  route_name?: string | null;
  calories?: number | null;
  notes?: string | null;
}

type PatchResult = { ok: true; patch: RunPatch } | { ok: false; error: string };

const EDITABLE = ['name', 'route_name', 'calories', 'notes'];

export function parseRunPatch(body: unknown): PatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object' };
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((k) => !EDITABLE.includes(k));
  if (unknown.length) return { ok: false, error: `Not editable: ${unknown.join(', ')}` };

  const patch: RunPatch = {};
  if ('name' in input) {
    if (input.name !== null && typeof input.name !== 'string') return { ok: false, error: 'name must be a string' };
    // Directus keeps a cleared name as '', not null.
    patch.name = ((input.name as string | null) ?? '').trim();
  }
  for (const key of ['route_name', 'notes'] as const) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v !== null && typeof v !== 'string') return { ok: false, error: `${key} must be a string or null` };
    patch[key] = v === null ? null : v.trim() || null;
  }
  if ('calories' in input) {
    const v = input.calories;
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      return { ok: false, error: 'calories must be a non-negative number or null' };
    }
    patch.calories = v as number | null;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: `Nothing to update; editable: ${EDITABLE.join(', ')}` };
  return { ok: true, patch };
}

export function parsePaging(params: URLSearchParams): { limit: number; offset: number; year: number | null } {
  const int = (key: string) => {
    const n = parseInt(params.get(key) ?? '', 10);
    return Number.isNaN(n) ? null : n;
  };
  return {
    limit: Math.min(Math.max(int('limit') ?? 50, 1), 500),
    offset: Math.max(int('offset') ?? 0, 0),
    year: int('year'),
  };
}

export function toRunSummary(a: Activity) {
  return {
    id: String(a.id),
    date: a.date,
    name: a.name || null,
    route_name: a.route_name,
    source: a.source,
    distance_m: a.distance_m,
    moving_time_s: a.moving_time_s,
    average_speed: a.average_speed ?? computedSpeed(a.distance_m, a.moving_time_s),
    total_elevation_gain: a.total_elevation_gain,
    average_heartrate: a.average_heartrate,
    calories: a.calories,
    start_lat: a.start_lat,
    start_lng: a.start_lng,
    photos: (a.photos ?? []).flatMap((p) => (p.directus_file_id ? [photoUrl(p.directus_file_id)] : [])),
  };
}
