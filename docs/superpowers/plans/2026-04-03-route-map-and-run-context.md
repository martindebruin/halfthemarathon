# Route Map Modal & Run Route Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a map modal to the routes stats table (so geo-named routes can be identified) and add a route context section to the run detail page (showing which route the run belongs to, its rank, and a history table).

**Architecture:** `computeRoutes` is extended to return `sample_polyline` (best run's polyline) and `runs` (all runs in cluster). A new `RouteMapModal.svelte` component renders a Leaflet modal. The run detail page server loads all activities, computes routes, and finds the matching cluster for the current activity.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), TypeScript, Leaflet, `@mapbox/polyline`, Vitest

---

## File Map

| File | Change |
|---|---|
| `frontend/src/lib/stats.ts` | Add `RouteRun` interface, extend `RouteStats` + `ActivityForRoutes`, update `computeRoutes` |
| `frontend/src/lib/stats.test.ts` | Tests for `sample_polyline` and `runs` in `computeRoutes` |
| `frontend/src/lib/components/RouteMapModal.svelte` | New — Leaflet map modal |
| `frontend/src/routes/stats/+page.svelte` | Add Map button + modal state |
| `frontend/src/routes/run/[id]/+page.server.ts` | Fetch all activities + compute `routeContext` |
| `frontend/src/routes/run/[id]/+page.svelte` | Add route context section |

---

## Task 1: Extend `computeRoutes` with `sample_polyline` and `runs`

**Files:**
- Modify: `frontend/src/lib/stats.ts`
- Modify: `frontend/src/lib/stats.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these test cases to the `describe('computeRoutes', ...)` block in `frontend/src/lib/stats.test.ts`:

```ts
  it('includes runs array sorted by date descending', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
      { id: '2', date: '2024-02-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].runs).toHaveLength(2);
    expect(routes[0].runs[0].id).toBe('2'); // most recent first
    expect(routes[0].runs[1].id).toBe('1');
  });

  it('sets sample_polyline from the fastest run', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: 'polyA' },
      { id: '2', date: '2024-02-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1400, average_speed: 3.57, start_lat: null, start_lng: null, summary_polyline: 'polyB' },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].sample_polyline).toBe('polyB'); // run 2 is faster (3.57 m/s)
  });

  it('sets sample_polyline to null when no run has a polyline', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: 1500, average_speed: 3.33, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].sample_polyline).toBeNull();
  });

  it('includes runs with null time_s for activities without moving_time_s', () => {
    const activities = [
      { id: '1', date: '2024-01-01', name: 'Run', route_name: 'Loop', distance_m: 5000, moving_time_s: null, average_speed: null, start_lat: null, start_lng: null, summary_polyline: null },
    ];
    const routes = computeRoutes(activities, []);
    expect(routes[0].runs).toHaveLength(1);
    expect(routes[0].runs[0].time_s).toBeNull();
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd frontend && npm run test -- --run stats
```

Expected: 4 new failures (runs/sample_polyline fields don't exist yet).

- [ ] **Step 3: Add `RouteRun` interface and extend `RouteStats` and `ActivityForRoutes` in `stats.ts`**

In `frontend/src/lib/stats.ts`, add `summary_polyline: string | null` to the `ActivityForRoutes` interface:

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
  summary_polyline: string | null;
}
```

Add the `RouteRun` interface and extend `RouteStats` (replace the existing `RouteStats` definition):

```ts
export interface RouteRun {
  id: string;
  date: string;
  time_s: number | null;
  pace_s_km: number | null;
}

export interface RouteStats {
  cluster_key: string;
  display_name: string;
  run_count: number;
  best_time_s: number | null;
  best_pace_s_km: number | null;
  sample_polyline: string | null;
  runs: RouteRun[];
}
```

- [ ] **Step 4: Update the `ClusterAcc` type and accumulation loop in `computeRoutes`**

Replace the `ClusterAcc` type definition inside `computeRoutes`:

```ts
  type ClusterAcc = {
    run_count: number;
    names: string[];
    distances: number[];
    times: Array<{ id: string; date: string; moving_time_s: number; distance_m: number; speed: number | null; polyline: string | null }>;
    allRuns: Array<{ id: string; date: string; moving_time_s: number | null; speed: number | null }>;
  };
```

Replace the `clusters.set(cluster_key, ...)` initialization to include `allRuns`:

```ts
    if (!clusters.has(cluster_key)) {
      clusters.set(cluster_key, { run_count: 0, names: [], distances: [], times: [], allRuns: [] });
    }
```

After `c.run_count++`, add an `allRuns` push and update the `times` push to include `id`, `date`, and `polyline`:

```ts
    c.run_count++;
    if (a.name) c.names.push(a.name);

    const speed = a.average_speed ?? (a.moving_time_s != null && a.moving_time_s > 0 && a.distance_m != null ? a.distance_m / a.moving_time_s : null);
    c.allRuns.push({ id: a.id, date: a.date, moving_time_s: a.moving_time_s ?? null, speed });

    if (a.distance_m != null) c.distances.push(a.distance_m);
    if (a.moving_time_s != null && a.distance_m != null) {
      c.times.push({ id: a.id, date: a.date, moving_time_s: a.moving_time_s, distance_m: a.distance_m, speed, polyline: a.summary_polyline });
    }
```

Note: the `speed` computation is now done once and shared between `allRuns` and `times`. Remove the old inline `speed` computation that was inside the `if (a.moving_time_s != null ...)` block.

- [ ] **Step 5: Update the results-building loop to populate `sample_polyline` and `runs`**

In the `for (const [cluster_key, acc] of clusters)` loop, after computing `best_pace_s_km`, add:

```ts
    // sample_polyline: polyline from the fastest run
    const bestSpeedRun = speedRuns.length > 0
      ? speedRuns.reduce((best, t) => (t.speed! > best.speed! ? t : best))
      : null;
    const sample_polyline = bestSpeedRun?.polyline ?? null;

    // runs: all activities in cluster, sorted date descending
    const runs: RouteRun[] = acc.allRuns
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        id: r.id,
        date: r.date,
        time_s: r.moving_time_s,
        pace_s_km: r.speed != null && r.speed > 0 ? Math.round(1000 / r.speed) : null,
      }));
```

Update the `results.push(...)` call to include the new fields:

```ts
    results.push({ cluster_key, display_name, run_count: acc.run_count, best_time_s, best_pace_s_km, sample_polyline, runs });
```

Also remove the now-redundant `const speed = ...` line that was previously inside the `if (a.moving_time_s != null && a.distance_m != null)` block (it has been moved earlier).

- [ ] **Step 6: Run tests to confirm they pass**

```bash
cd frontend && npm run test -- --run stats
```

Expected: all 20 tests pass (16 existing + 4 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/stats.ts frontend/src/lib/stats.test.ts
git commit -m "feat: extend computeRoutes with sample_polyline and runs array"
```

---

## Task 2: Create `RouteMapModal.svelte`

**Files:**
- Create: `frontend/src/lib/components/RouteMapModal.svelte`

- [ ] **Step 1: Create the component**

Create `frontend/src/lib/components/RouteMapModal.svelte` with this content:

```svelte
<script lang="ts">
  import polylineLib from '@mapbox/polyline';

  let {
    polyline,
    title,
    onclose,
  }: {
    polyline: string;
    title: string;
    onclose: () => void;
  } = $props();

  let mapEl: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    if (!mapEl) return;
    let map: import('leaflet').Map | undefined;
    (async () => {
      const L = (await import('leaflet')).default;
      const coords = polylineLib.decode(polyline) as [number, number][];
      if (coords.length === 0) return;
      map = L.map(mapEl!);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
      const line = L.polyline(coords, { color: '#f97316', weight: 3, opacity: 0.9 });
      line.addTo(map);
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
      L.circleMarker(coords[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#f97316', fillColor: '#f97316', fillOpacity: 1, weight: 2 }).addTo(map);
    })();
    return () => map?.remove();
  });
</script>

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <span class="modal-title">{title}</span>
      <button class="close-btn" onclick={onclose} aria-label="Close">×</button>
    </div>
    <div class="map-container" bind:this={mapEl}></div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--border);
    width: min(600px, 90vw);
    display: flex;
    flex-direction: column;
  }
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .modal-title { font-size: 0.85rem; font-weight: 500; }
  .close-btn {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 1.4rem;
    padding: 0;
    line-height: 1;
  }
  .close-btn:hover { color: var(--text); }
  .map-container { height: 400px; width: 100%; background: #111; }
</style>
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/components/RouteMapModal.svelte
git commit -m "feat: add RouteMapModal component"
```

---

## Task 3: Add Map button and modal to the stats page

**Files:**
- Modify: `frontend/src/routes/stats/+page.svelte`

- [ ] **Step 1: Add the import and state**

In the `<script lang="ts">` block, add the import at the top alongside the other component imports:

```ts
  import RouteMapModal from '$lib/components/RouteMapModal.svelte';
```

Add a state variable after the existing `$state` declarations:

```ts
  let previewRoute: (typeof data.routes)[0] | null = $state(null);
```

- [ ] **Step 2: Add the Map button to each route row**

In the routes table, the route name cell currently looks like:

```svelte
              <td>
                {#if editingKey === route.cluster_key}
                  <input ... />
                {:else}
                  <button class="route-name-btn" ...>{route.display_name}</button>
                {/if}
              </td>
```

Update it to add a Map button after the name button:

```svelte
              <td class="route-name-cell">
                {#if editingKey === route.cluster_key}
                  <input
                    class="route-edit"
                    type="text"
                    bind:value={editingValue}
                    bind:this={editInputEl}
                    onblur={() => commitEdit(route.cluster_key)}
                    onkeydown={(e) => handleKeydown(e, route.cluster_key)}
                  />
                {:else}
                  <button class="route-name-btn" onclick={() => startEdit(route.cluster_key, route.display_name)}>
                    {route.display_name}
                  </button>
                  {#if route.sample_polyline}
                    <button class="map-btn" onclick={() => previewRoute = route}>Map</button>
                  {/if}
                {/if}
              </td>
```

- [ ] **Step 3: Add the modal below the routes section**

After the closing `</section>` of the routes section, add:

```svelte
  {#if previewRoute?.sample_polyline}
    <RouteMapModal
      polyline={previewRoute.sample_polyline}
      title={previewRoute.display_name}
      onclose={() => previewRoute = null}
    />
  {/if}
```

- [ ] **Step 4: Add CSS**

Add these rules inside the `<style>` block:

```css
  .route-name-cell { display: flex; align-items: center; gap: 0.5rem; }
  .map-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    flex-shrink: 0;
  }
  .map-btn:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no new errors.

- [ ] **Step 6: Run tests**

```bash
cd frontend && npm run test -- --run
```

Expected: all 20 tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/routes/stats/+page.svelte
git commit -m "feat: add route map preview button to stats routes table"
```

---

## Task 4: Extend the run detail page server

**Files:**
- Modify: `frontend/src/routes/run/[id]/+page.server.ts`

- [ ] **Step 1: Update the imports**

Replace the current import line in `frontend/src/routes/run/[id]/+page.server.ts`:

```ts
import { getActivity, getActivityPhotos, getAllActivities, getRouteAliases } from '$lib/server/directus.js';
import { computeRoutes } from '$lib/stats.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
```

- [ ] **Step 2: Extend the `load` function**

Replace the entire `load` function:

```ts
export const load: PageServerLoad = async ({ params }) => {
  try {
    const [activity, photos, allActivities, aliases] = await Promise.all([
      getActivity(params.id),
      getActivityPhotos(params.id),
      getAllActivities(),
      getRouteAliases(),
    ]);
    const routes = computeRoutes(allActivities, aliases);
    const routeContext = routes.find((r) => r.runs.some((run) => run.id === params.id)) ?? null;
    return { activity, photos, routeContext };
  } catch {
    error(404, 'Activity not found');
  }
};
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/run/[id]/+page.server.ts
git commit -m "feat: compute route context in run detail page server"
```

---

## Task 5: Add route context section to the run detail page

**Files:**
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 1: Add state and helpers to the script block**

Add after the `const DIRECTUS_URL` line in the `<script lang="ts">` block:

```ts
  let showRouteHistory = $state(false);

  const thisRouteRun = $derived(
    data.routeContext?.runs.find((r) => r.id === data.activity.id) ?? null
  );

  const routeRank = $derived.by(() => {
    if (!data.routeContext || !thisRouteRun?.time_s) return null;
    const timed = [...data.routeContext.runs.filter((r) => r.time_s != null)].sort(
      (a, b) => a.time_s! - b.time_s!
    );
    return timed.findIndex((r) => r.id === data.activity.id) + 1;
  });

  function fmtPace(s_km: number): string {
    const m = Math.floor(s_km / 60);
    const s = Math.round(s_km % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
  }
```

- [ ] **Step 2: Add the route context section to the template**

In the template, inside `.stats-col`, add this section after the `{#if activity.notes}` block (after the notes section's closing `{/if}`):

```svelte
      {#if data.routeContext}
        {@const rc = data.routeContext}
        <div class="route-context">
          <h2>Route</h2>
          <div class="route-headline">
            <a href="/stats" class="route-name-link">{rc.display_name}</a>
            {#if routeRank != null}
              <span class="route-rank">#{routeRank} of {rc.runs.filter((r) => r.time_s != null).length} timed runs</span>
            {/if}
          </div>
          <div class="route-compare">
            {#if thisRouteRun?.time_s != null}
              <div class="compare-row">
                <span class="compare-label">Time</span>
                <span>{formatDuration(thisRouteRun.time_s)}</span>
                {#if rc.best_time_s != null && rc.best_time_s !== thisRouteRun.time_s}
                  <span class="muted">best {formatDuration(rc.best_time_s)}</span>
                {/if}
              </div>
            {/if}
            {#if thisRouteRun?.pace_s_km != null}
              <div class="compare-row">
                <span class="compare-label">Pace</span>
                <span>{fmtPace(thisRouteRun.pace_s_km)}</span>
                {#if rc.best_pace_s_km != null && rc.best_pace_s_km !== thisRouteRun.pace_s_km}
                  <span class="muted">best {fmtPace(rc.best_pace_s_km)}</span>
                {/if}
              </div>
            {/if}
          </div>
          <button class="toggle-history-btn" onclick={() => showRouteHistory = !showRouteHistory}>
            {showRouteHistory ? 'Hide' : `All ${rc.run_count} runs`} {showRouteHistory ? '▴' : '▾'}
          </button>
          {#if showRouteHistory}
            <table class="route-history">
              <thead>
                <tr><th>Date</th><th>Time</th><th>Pace</th></tr>
              </thead>
              <tbody>
                {#each rc.runs as run (run.id)}
                  <tr class:current-run={run.id === data.activity.id}>
                    <td><a href="/run/{run.id}">{run.date.slice(0, 10)}</a></td>
                    <td>{run.time_s != null ? formatDuration(run.time_s) : '—'}</td>
                    <td>{run.pace_s_km != null ? fmtPace(run.pace_s_km) : '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
```

- [ ] **Step 3: Add CSS**

Add these rules inside the `<style>` block:

```css
  .route-context { margin-top: 1.5rem; }
  .route-context h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.75rem; }
  .route-headline { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; flex-wrap: wrap; }
  .route-name-link { font-weight: 500; color: var(--text); }
  .route-name-link:hover { color: var(--accent); }
  .route-rank { font-size: 0.8rem; color: var(--muted); }
  .route-compare { margin-bottom: 0.75rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .compare-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; }
  .compare-label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; width: 3rem; flex-shrink: 0; }
  .muted { color: var(--muted); }
  .toggle-history-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: pointer;
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    margin-bottom: 0.75rem;
  }
  .toggle-history-btn:hover { border-color: var(--accent); color: var(--accent); }
  .route-history { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .route-history th { text-align: left; padding: 0.4rem 0.5rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  .route-history td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  .route-history tr.current-run td { color: var(--accent); }
  .route-history a { color: inherit; }
  .route-history a:hover { text-decoration: underline; }
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npm run check
```

Expected: no new errors.

- [ ] **Step 5: Run all tests**

```bash
cd frontend && npm run test -- --run
```

Expected: all 20 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/routes/run/[id]/+page.svelte
git commit -m "feat: add route context section to run detail page"
```

---

## Task 6: Deploy

- [ ] **Step 1: Sync frontend source**

```bash
rsync -avz --delete frontend/src/ dedibox1:/home/martin/dockers/halfthemarathon/frontend/src/
```

- [ ] **Step 2: Rebuild and restart frontend**

```bash
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d frontend"
```

Expected: build succeeds, container starts.
