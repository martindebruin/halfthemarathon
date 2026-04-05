import type { PageServerLoad } from './$types.js';
import { readItems } from '@directus/sdk';
import { createDirectus, rest, staticToken } from '@directus/sdk';

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const WEBHOOK_URL = 'http://webhook-listener:3001/health';

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const load: PageServerLoad = async () => {
  const c = createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_TOKEN)).with(rest());

  const [directusOk, webhookOk, activityCount, photoCount, latestActivity] = await Promise.all([
    ping(`${DIRECTUS_URL}/server/health`),
    ping(WEBHOOK_URL),
    c.request(readItems('activities', { aggregate: { count: ['id'] }, limit: 1 }))
      .then((r) => (r as Array<{ count: { id: string } }>)[0]?.count?.id ?? '0')
      .catch(() => 'error'),
    c.request(readItems('photos', { aggregate: { count: ['id'] }, limit: 1 }))
      .then((r) => (r as Array<{ count: { id: string } }>)[0]?.count?.id ?? '0')
      .catch(() => 'error'),
    c.request(readItems('activities', { sort: ['-date'], limit: 1, fields: ['date', 'name'] }))
      .then((r) => (r as Array<{ date: string; name: string | null }>)[0] ?? null)
      .catch(() => null),
  ]);

  return { directusOk, webhookOk, activityCount, photoCount, latestActivity, checkedAt: new Date().toISOString() };
};
