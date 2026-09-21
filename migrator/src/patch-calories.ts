import 'dotenv/config';

const WEIGHT_KG = 82;

function getDirectusUrl(): string {
  return process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
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

function calculateCalories(distanceM: number, movingTimeS: number): number {
  // speed_m_per_min = distance_m / (moving_time_s / 60)
  const speedMPerMin = distanceM / (movingTimeS / 60);

  // VO2_ml_kg_min = 0.2 × speed_m_per_min + 3.5
  const vo2MlKgMin = 0.2 * speedMPerMin + 3.5;

  // calories = VO2_ml_kg_min × 82 × (moving_time_s / 60) × 0.005
  const calories = vo2MlKgMin * WEIGHT_KG * (movingTimeS / 60) * 0.005;

  return Math.round(calories);
}

async function main() {
  // Fetch all activities with zero calories
  console.log('Fetching zero-calorie activities from Directus...');
  const result = await directusFetch(
    '/items/activities?filter[calories][_eq]=0&filter[distance_m][_nnull]=true&filter[moving_time_s][_nnull]=true&fields=id,distance_m,moving_time_s&limit=-1'
  ) as { data: Array<{ id: string; distance_m: number; moving_time_s: number }> };

  const toUpdate = result.data;
  console.log(`Found ${toUpdate.length} activities to patch`);

  if (toUpdate.length === 0) {
    console.log('Nothing to patch — either all activities already have calories, or the Directus filter returned no results. Check connection and filters.');
    return;
  }

  let patched = 0;
  let skipped = 0;
  let errors = 0;

  for (const activity of toUpdate) {
    try {
      const { distance_m, moving_time_s } = activity;

      // Skip if missing required fields
      if (distance_m === null || distance_m === undefined || moving_time_s === null || moving_time_s === undefined) {
        skipped++;
        continue;
      }

      // Skip if values are zero (edge case)
      if (distance_m === 0 || moving_time_s === 0) {
        skipped++;
        continue;
      }

      const calories = calculateCalories(distance_m, moving_time_s);

      await directusFetch(`/items/activities/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ calories }),
      });

      patched++;
      if (patched % 50 === 0) {
        console.log(`  ${patched} patched, ${skipped} skipped, ${errors} errors`);
      }
    } catch (err) {
      errors++;
      console.error(`Error patching activity ${activity.id}:`, err);
    }
  }

  console.log(`\nDone. ${patched} patched, ${skipped} skipped, ${errors} errors`);
}

main().catch((err) => { console.error(err); process.exit(1); });
