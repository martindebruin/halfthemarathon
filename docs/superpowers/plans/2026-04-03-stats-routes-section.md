# Stats Routes Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Routes section to the stats page showing run count, best time, and best pace per route, with inline rename support.

**Architecture:** Activities are clustered into routes by `route_name` (when set) or by start lat/lng + distance bucket (when not). Cluster display names are persisted in a new `route_aliases` Directus collection and applied at render time. Rename is handled by a SvelteKit API route that upserts into `route_aliases`.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript, `@directus/sdk` v18, Directus REST API, Vitest

---

## File Map

| File | Change |
|---|---|
| `migrator/src/setup-schema.ts` | Add `route_aliases` collection |
| `frontend/src/lib/server/directus.ts` | Add `start_lat`/`start_lng` to `getAllActivities`, add `getRouteAliases()`, add `upsertRouteAlias()` |
| `frontend/src/lib/stats.ts` | Add `computeRoutes()` |
| `frontend/src/lib/stats.test.ts` | Tests for `computeRoutes()` |
| `frontend/src/routes/stats/+page.server.ts` | Call `getRouteAliases()`, call `computeRoutes()`, add `routes` to return |
| `frontend/src/routes/api/routes/rename/+server.ts` | New — POST handler for rename |
| `frontend/src/routes/stats/+page.svelte` | New routes section with inline edit |

---

## Task 1: Add `route_aliases` collection to setup-schema

**Files:**
- Modify: `migrator/src/setup-schema.ts`

- [ ] **Step 1: Add the collection block**

In `migrator/src/setup-schema.ts`, add the following block immediately before the final `console.log('Schema setup complete.')` line:

```ts
  // ── route_aliases ──────────────────────────────────────────────────────
  await createCollection('route_aliases', { note: 'Custom display names for run route clusters' });
  console.log('  Fields:');
  const routeAliasFields = [
    { field: 'cluster_key',  type: 'string', schema: { is_nullable: false, is_unique: true, max_length: 128 } },
    { field: 'display_name', type: 'string', schema: { is_nullable: false, max_length: 255 } },
  ];
  for (const f of routeAliasFields) await createField('route_aliases', f);
  console.log('\n');
```

- [ ] **Step 2: Run setup-schema against local Directus**

```bash
cd migrator && npm run setup-schema
```

Expected output includes:
```
  Collection: route_aliases
  Fields:
..
```

No errors. If Directus is not running locally, skip this step and note it must be run on the server before deploying.

- [ ] **Step 3: Commit**

```bash
git add migrator/src/setup-schema.ts
git commit -m "feat: add route_aliases collection to schema"
```

---

## Task 2: Add `getRouteAliases` and `upsertRouteAlias` to directus.ts

**Files:**
- Modify: `frontend/src/lib/server/directus.ts`

- [ ] **Step 1: Add `createItem` and `updateItem` to the SDK import**

Change the import at line 1 of `frontend/src/lib/server/directus.ts`:

```ts
import { createDirectus, rest, staticToken, readItems, readItem, createItem, updateItem } from '@directus/sdk';
```

- [ ] **Step 2: Add `start_lat` and `start_lng` to `getAllActivities` fields list**

In `getAllActivities()`, the fields array currently ends with `'photos.directus_file_id'`. Update it to:

```ts
      fields: [
        'id', 'strava_id', 'date', 'name', 'route_name', 'distance_m', 'moving_time_s',
        'average_speed', 'average_heartrate', 'summary_polyline', 'total_elevation_gain',
        'type', 'sport_type', 'best_efforts', 'start_lat', 'start_lng',
        'photos.directus_file_id',
      ],
```

- [ ] **Step 3: Add `getRouteAliases` and `upsertRouteAlias` functions**

Add these two functions at the end of the file, before the `export type` line:

```ts
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
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no errors related to the changed file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/server/directus.ts
git commit -m "feat: add getRouteAliases and upsertRouteAlias to directus client"
```

---

## Task 3: Add `computeRoutes` to stats.ts with tests

**Files:**
- Modify: `frontend/src/lib/stats.ts`
- Modify: `frontend/src/lib/stats.test.ts`

- [ ] **Step 1: Write the failing tests first**

Add the following `describe` block to `frontend/src/lib/stats.test.ts`:

```ts
describe('computeRoutes', () => {
  it('returns empty array for no activities', () => {
    expect(computeRoutes([], [])).toEqual([]);
  });

  it('groups activities by route_name', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Djurgården', distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: null, start_lng: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Djurgården', distance_m: 10000, moving_time_s: 2900, average_speed: 3.45, start_lat: null, start_lng: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes).toHaveLength(1);
    expect(routes[0].cluster_key).toBe('name:Djurgården');
    expect(routes[0].run_count).toBe(2);
  });

  it('groups unnamed activities by geo cluster', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Morning Run', route_name: null, distance_m: 10200, moving_time_s: 3100, average_speed: null, start_lat: 59.333, start_lng: 18.065 },
      { id: '2', date: '2024-01-08', name: 'Morning Run', route_name: null, distance_m: 9800,  moving_time_s: 2950, average_speed: null, start_lat: 59.333, start_lng: 18.065 },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes).toHaveLength(1);
    expect(routes[0].cluster_key).toBe('geo:59.333_18.065_10km');
    expect(routes[0].run_count).toBe(2);
    expect(routes[0].display_name).toBe('Morning Run');
  });

  it('applies alias override for display name', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Morning Run', route_name: null, distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: 59.333, start_lng: 18.065 },
    ];
    const aliases = [{ cluster_key: 'geo:59.333_18.065_10km', display_name: 'Ladugårdsparken Loop' }];
    const routes = computeRoutes(activities, aliases);
    expect(routes[0].display_name).toBe('Ladugårdsparken Loop');
  });

  it('picks best pace as lowest s/km', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Park Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Park Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null },
    ];
    const routes = computeRoutes(activities, []);
    // best speed is 3.57 m/s → 1000/3.57 ≈ 280 s/km
    expect(routes[0].best_pace_s_km).toBe(Math.round(1000 / 3.57));
  });

  it('picks best time from same-distance runs (within 10% of median)', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 10000, moving_time_s: 3200, average_speed: 3.13, start_lat: null, start_lng: null },
      { id: '2', date: '2024-01-08', name: 'Run', route_name: 'Loop', distance_m: 10000, moving_time_s: 3000, average_speed: 3.33, start_lat: null, start_lng: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].best_time_s).toBe(3000);
  });

  it('sorts by run_count descending', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'A', route_name: 'Short', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null },
      { id: '2', date: '2024-01-01', name: 'B', route_name: 'Long',  distance_m: 15000, moving_time_s: 4500, average_speed: 3.33, start_lat: null, start_lng: null },
      { id: '3', date: '2024-01-08', name: 'B', route_name: 'Long',  distance_m: 15000, moving_time_s: 4400, average_speed: 3.41, start_lat: null, start_lng: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].cluster_key).toBe('name:Long');
    expect(routes[1].cluster_key).toBe('name:Short');
  });

  it('excludes activities with no route_name and no geo data', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: null, distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null },
    ];
    expect(computeRoutes(activities, [])).toHaveLength(0);
  });
});
```

Also add `computeRoutes` to the import at the top of the test file:

```ts
import { calculateStreaks, calculatePersonalBests, computeRoutes, MILESTONES } from './stats.js';
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npm run test -- --run stats
```

Expected: multiple test failures with "computeRoutes is not a function" or similar.

- [ ] **Step 3: Add the types and `computeRoutes` function to `stats.ts`**

Add the following to the end of `frontend/src/lib/stats.ts`:

```ts
interface ActivityForRoutes {
  id: string;
  date: string;
  name: string | null;
  route_name: string | null;
  distance_m: number | null;
  moving_time_s: number | null;
  average_speed: number | null;
  start_lat: number | null;
  start_lng: number | null;
}

export interface RouteStats {
  cluster_key: string;
  display_name: string;
  run_count: number;
  best_time_s: number | null;
  best_pace_s_km: number | null;
}

export function computeRoutes(
  activities: ActivityForRoutes[],
  aliases: Array<{ cluster_key: string; display_name: string }>
): RouteStats[] {
  const aliasMap = new Map(aliases.map((a) => [a.cluster_key, a.display_name]));

  type ClusterAcc = {
    run_count: number;
    names: string[];
    distances: number[];
    times: Array<{ moving_time_s: number; distance_m: number; speed: number | null }>;
  };

  const clusters = new Map<string, ClusterAcc>();

  for (const a of activities) {
    let cluster_key: string;
    if (a.route_name) {
      cluster_key = `name:${a.route_name}`;
    } else if (a.start_lat != null && a.start_lng != null && a.distance_m != null) {
      const lat = a.start_lat.toFixed(3);
      const lng = a.start_lng.toFixed(3);
      const distKm = Math.round(a.distance_m / 1000);
      cluster_key = `geo:${lat}_${lng}_${distKm}km`;
    } else {
      continue;
    }

    if (!clusters.has(cluster_key)) {
      clusters.set(cluster_key, { run_count: 0, names: [], distances: [], times: [] });
    }
    const c = clusters.get(cluster_key)!;
    c.run_count++;
    if (a.name) c.names.push(a.name);
    if (a.distance_m != null) c.distances.push(a.distance_m);
    if (a.moving_time_s != null && a.distance_m != null) {
      const speed = a.average_speed ?? (a.moving_time_s > 0 ? a.distance_m / a.moving_time_s : null);
      c.times.push({ moving_time_s: a.moving_time_s, distance_m: a.distance_m, speed });
    }
  }

  const results: RouteStats[] = [];

  for (const [cluster_key, acc] of clusters) {
    let display_name: string;
    if (aliasMap.has(cluster_key)) {
      display_name = aliasMap.get(cluster_key)!;
    } else if (cluster_key.startsWith('name:')) {
      display_name = cluster_key.slice(5);
    } else {
      const freq = new Map<string, number>();
      for (const n of acc.names) freq.set(n, (freq.get(n) ?? 0) + 1);
      let best = '';
      let bestCount = 0;
      for (const [n, count] of freq) {
        if (count > bestCount) { bestCount = count; best = n; }
      }
      display_name = best || cluster_key;
    }

    const sortedDist = [...acc.distances].sort((a, b) => a - b);
    const medianDist = sortedDist[Math.floor(sortedDist.length / 2)] ?? 0;

    const sameDistTimes = medianDist > 0
      ? acc.times.filter((t) => Math.abs(t.distance_m - medianDist) / medianDist <= 0.1)
      : acc.times;
    const best_time_s = sameDistTimes.length > 0
      ? Math.min(...sameDistTimes.map((t) => t.moving_time_s))
      : null;

    const speedRuns = acc.times.filter((t) => t.speed != null && t.speed > 0);
    const bestSpeed = speedRuns.length > 0 ? Math.max(...speedRuns.map((t) => t.speed!)) : null;
    const best_pace_s_km = bestSpeed != null ? Math.round(1000 / bestSpeed) : null;

    results.push({ cluster_key, display_name, run_count: acc.run_count, best_time_s, best_pace_s_km });
  }

  return results.sort((a, b) => b.run_count - a.run_count);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd frontend && npm run test -- --run stats
```

Expected: all tests in `stats.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stats.ts frontend/src/lib/stats.test.ts
git commit -m "feat: add computeRoutes to stats lib with tests"
```

---

## Task 4: Wire `computeRoutes` into the stats page server

**Files:**
- Modify: `frontend/src/routes/stats/+page.server.ts`

- [ ] **Step 1: Add imports**

At the top of `frontend/src/routes/stats/+page.server.ts`, update the two import lines:

```ts
import { getAllActivities, getRecords, getRouteAliases } from '$lib/server/directus.js';
import { calculateStreaks, calculatePersonalBests, computeRoutes, MILESTONES } from '$lib/stats.js';
```

- [ ] **Step 2: Fetch aliases in parallel and compute routes**

In the `load` function, the first line is currently:
```ts
const [activities, records] = await Promise.all([getAllActivities(), getRecords()]);
```

Replace it with:
```ts
const [activities, records, aliases] = await Promise.all([
  getAllActivities(),
  getRecords(),
  getRouteAliases(),
]);
```

Then, just before the `return {` statement, add:

```ts
  const routes = computeRoutes(activities, aliases);
```

- [ ] **Step 3: Add `routes` to the return value**

In the `return { ... }` block, add `routes` alongside the existing fields:

```ts
  return {
    weekly,
    records: { ...records, fastestPaceActivity },
    daily,
    availableYears,
    milestones,
    streaks,
    personalBests,
    yoy,
    paceTrends,
    routes,
  };
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/stats/+page.server.ts
git commit -m "feat: compute routes in stats page server load"
```

---

## Task 5: Create the rename API route

**Files:**
- Create: `frontend/src/routes/api/routes/rename/+server.ts`

- [ ] **Step 1: Create the file**

Create `frontend/src/routes/api/routes/rename/+server.ts` with this content:

```ts
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/api/routes/rename/+server.ts
git commit -m "feat: add rename API route for route aliases"
```

---

## Task 6: Add routes section to the stats page UI

**Files:**
- Modify: `frontend/src/routes/stats/+page.svelte`

- [ ] **Step 1: Add script state and helper for inline edit**

In the `<script lang="ts">` block, add these after the existing `$derived` declarations:

```ts
  import { invalidateAll } from '$app/navigation';

  let editingKey: string | null = $state(null);
  let editingValue: string = $state('');

  function startEdit(cluster_key: string, current_name: string) {
    editingKey = cluster_key;
    editingValue = current_name;
  }

  async function commitEdit(cluster_key: string) {
    if (!editingValue.trim() || editingValue.trim() === '') {
      editingKey = null;
      return;
    }
    await fetch('/api/routes/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cluster_key, display_name: editingValue.trim() }),
    });
    editingKey = null;
    await invalidateAll();
  }

  function handleKeydown(e: KeyboardEvent, cluster_key: string) {
    if (e.key === 'Enter') commitEdit(cluster_key);
    if (e.key === 'Escape') editingKey = null;
  }
```

- [ ] **Step 2: Add `formatDuration` is already imported — confirm the import line**

The import at the top of the script should already include `formatDuration`:
```ts
import { formatDistance, formatPace, formatDate, formatDuration } from '$lib/utils.js';
```

If `formatDuration` is missing from the import, add it. No other changes to imports needed.

- [ ] **Step 3: Add the routes section to the template**

Add this section immediately after the closing `</section>` of the "Personal records" section (after line `</section>` that closes the `.records` section):

```svelte
  <section class="section">
    <h2>Routes</h2>
    {#if data.routes.length > 0}
      <table class="pb-table">
        <thead>
          <tr>
            <th>Route</th>
            <th>Runs</th>
            <th>Best time</th>
            <th>Best pace</th>
          </tr>
        </thead>
        <tbody>
          {#each data.routes as route (route.cluster_key)}
            <tr>
              <td>
                {#if editingKey === route.cluster_key}
                  <input
                    class="route-edit"
                    type="text"
                    bind:value={editingValue}
                    onblur={() => commitEdit(route.cluster_key)}
                    onkeydown={(e) => handleKeydown(e, route.cluster_key)}
                    autofocus
                  />
                {:else}
                  <button class="route-name-btn" onclick={() => startEdit(route.cluster_key, route.display_name)}>
                    {route.display_name}
                  </button>
                {/if}
              </td>
              <td class:muted={route.run_count === 1}>{route.run_count}</td>
              <td>{route.best_time_s != null ? formatDuration(route.best_time_s) : '—'}</td>
              <td>{route.best_pace_s_km != null ? fmtPace(route.best_pace_s_km) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="empty">No route data yet.</p>
    {/if}
  </section>
```

- [ ] **Step 4: Add CSS for the inline edit elements**

Add these rules inside the `<style>` block:

```css
  .route-name-btn {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-align: left;
  }
  .route-name-btn:hover { color: var(--accent); }
  .route-edit {
    background: var(--surface);
    border: 1px solid var(--accent);
    color: var(--text);
    font-size: inherit;
    padding: 0.1rem 0.3rem;
    width: 100%;
  }
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
cd frontend && npm run test -- --run
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/routes/stats/+page.svelte
git commit -m "feat: add routes section to stats page with inline rename"
```

---

## Task 7: Deploy

- [ ] **Step 1: Run setup-schema on the server** (if not done in Task 1)

```bash
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon/migrator && npm run setup-schema"
```

Expected: `route_aliases` collection created (or `already exists` if re-run).

- [ ] **Step 2: Sync frontend source**

```bash
rsync -avz --delete frontend/src/ dedibox1:/home/martin/dockers/halfthemarathon/frontend/src/
```

- [ ] **Step 3: Rebuild and restart frontend**

```bash
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d frontend"
```

- [ ] **Step 4: Verify**

Open the stats page in a browser. Confirm the Routes section appears. Click a route name, type a new name, press Enter. Reload the page and confirm the new name persists.
