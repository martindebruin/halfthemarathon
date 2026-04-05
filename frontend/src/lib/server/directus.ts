import { createDirectus, rest, staticToken, readItems, readItem, createItem, updateItem } from '@directus/sdk';

interface Activity {
  id: string;
  strava_id: number | null;
  runkeeper_id: string | null;
  source: string;
  date: string;
  name: string | null;
  route_name: string | null;
  type: string | null;
  sport_type: string | null;
  distance_m: number | null;
  moving_time_s: number | null;
  elapsed_time_s: number | null;
  total_elevation_gain: number | null;
  average_speed: number | null;
  max_speed: number | null;
  average_heartrate: number | null;
  max_heartrate: number | null;
  average_cadence: number | null;
  summary_polyline: string | null;
  best_efforts: string | null;
  start_lat: number | null;
  start_lng: number | null;
  splits_metric: string | null;
  calories: number | null;
  suffer_score: number | null;
  pr_count: number | null;
  notes: string | null;
  photos?: Array<{ directus_file_id: string | null }>;
}

interface Photo {
  id: string;
  activity_id: string;
  directus_file_id: string | null;
  original_filename: string;
  caption: string | null;
  lat: number | null;
  lng: number | null;
}

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';

function client() {
  return createDirectus(DIRECTUS_URL)
    .with(staticToken(DIRECTUS_TOKEN))
    .with(rest());
}

export async function getAllActivities(): Promise<Activity[]> {
  const c = client();
  return c.request(
    readItems('activities', {
      sort: ['-date'],
      limit: -1,
      fields: [
        'id', 'strava_id', 'date', 'name', 'route_name', 'distance_m', 'moving_time_s',
        'average_speed', 'average_heartrate', 'summary_polyline', 'total_elevation_gain',
        'type', 'sport_type', 'best_efforts', 'start_lat', 'start_lng',
        'photos.directus_file_id',
      ],
    })
  ) as Promise<Activity[]>;
}

export async function getAllActivityIds(): Promise<string[]> {
  const c = client();
  const items = await c.request(
    readItems('activities', { fields: ['id'], limit: -1 })
  ) as Array<{ id: string }>;
  return items.map((i) => i.id);
}

export async function getActivity(id: string): Promise<Activity> {
  const c = client();
  return c.request(readItem('activities', id)) as Promise<Activity>;
}

export async function getActivityPhotos(activityId: string): Promise<Photo[]> {
  const c = client();
  return c.request(
    readItems('photos', {
      filter: { activity_id: { _eq: activityId } },
      fields: ['id', 'directus_file_id', 'original_filename', 'caption', 'lat', 'lng'],
    })
  ) as Promise<Photo[]>;
}

export async function getHeroPhoto(activityId: string): Promise<Photo | null> {
  const c = client();
  const photos = await c.request(
    readItems('photos', {
      filter: { activity_id: { _eq: activityId } },
      fields: ['id', 'directus_file_id', 'original_filename'],
      limit: 1,
    })
  ) as Photo[];
  return photos[0] ?? null;
}

export async function getRecords(): Promise<{
  longestRun: Activity | null;
  mostElevation: Activity | null;
  fastestPaceActivity: Activity | null;
}> {
  const c = client();
  const [longest, elevation, fastestPace] = await Promise.all([
    c.request(readItems('activities', {
      sort: ['-distance_m'], limit: 1,
      fields: ['id', 'date', 'name', 'route_name', 'distance_m', 'total_elevation_gain', 'average_speed'],
    })) as Promise<Activity[]>,
    c.request(readItems('activities', {
      sort: ['-total_elevation_gain'], limit: 1,
      fields: ['id', 'date', 'name', 'route_name', 'distance_m', 'total_elevation_gain', 'average_speed'],
    })) as Promise<Activity[]>,
    c.request(readItems('activities', {
      sort: ['-average_speed'], limit: 1,
      filter: { distance_m: { _gte: 5000 } },
      fields: ['id', 'date', 'name', 'route_name', 'distance_m', 'total_elevation_gain', 'average_speed'],
    })) as Promise<Activity[]>,
  ]);
  return {
    longestRun: longest[0] ?? null,
    mostElevation: elevation[0] ?? null,
    fastestPaceActivity: fastestPace[0] ?? null,
  };
}

export async function getRouteAliases(): Promise<Array<{ cluster_key: string; display_name: string }>> {
  const c = client();
  return c.request(
    readItems('route_aliases', {
      fields: ['cluster_key', 'display_name'],
      limit: -1,
    })
  ) as Promise<Array<{ cluster_key: string; display_name: string }>>;
}

export async function upsertRouteAlias(cluster_key: string, display_name: string): Promise<void> {
  const c = client();
  const existing = await c.request(
    readItems('route_aliases', {
      filter: { cluster_key: { _eq: cluster_key } },
      fields: ['id'],
      limit: 1,
    })
  ) as Array<{ id: string }>;

  if (existing.length > 0) {
    await c.request(updateItem('route_aliases', existing[0].id, { display_name }));
  } else {
    await c.request(createItem('route_aliases', { cluster_key, display_name }));
  }
}

export type { Activity, Photo };
