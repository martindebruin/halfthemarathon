# Route Map Modal & Run Route Context Design

**Date:** 2026-04-03  
**Status:** Approved

---

## Overview

Two related enhancements to the routes feature:

1. **Stats page** — a "Map" button per route row that opens a modal showing the route on a Leaflet map, so geo-named routes can be visually identified before renaming.
2. **Run detail page** — a "Route" section showing which route a run belongs to, headline comparison stats (rank, time vs best, pace vs best), and an expandable history table of all runs on that route.

---

## Data Changes

### `RouteStats` interface (in `frontend/src/lib/stats.ts`)

Two new fields added:

```ts
export interface RouteStats {
  cluster_key: string;
  display_name: string;
  run_count: number;
  best_time_s: number | null;
  best_pace_s_km: number | null;
  sample_polyline: string | null;   // NEW: polyline from the fastest run in cluster
  runs: RouteRun[];                 // NEW: all runs in cluster, sorted date descending
}

export interface RouteRun {
  id: string;
  date: string;
  time_s: number | null;
  pace_s_km: number | null;
}
```

### `ActivityForRoutes` interface

Add `summary_polyline: string | null` — already fetched by `getAllActivities()`, no Directus query change needed.

### `computeRoutes` logic

- Accumulate `summary_polyline` per run in the cluster accumulator
- After computing `best_pace_s_km`, pick the polyline from the run that produced `bestSpeed` as `sample_polyline`
- Build `runs` array from all accumulated times, sorted by date descending

---

## Stats Page: Route Map Modal

### New component: `frontend/src/lib/components/RouteMapModal.svelte`

Props: `polyline: string`, `title: string`, `onclose: () => void`

- Renders a full-screen modal overlay (same visual pattern as `Lightbox.svelte`)
- Loads Leaflet inside `$effect()` (required for Svelte 5 runes — `onMount` is tree-shaken)
- Decodes `polyline` with `@mapbox/polyline` and fits the map to the route bounds
- Close button + click-outside dismiss (calls `onclose`)
- If `polyline` is empty/null, component renders nothing

### Stats page (`frontend/src/routes/stats/+page.svelte`)

- Each route row with a non-null `sample_polyline` gets a "Map" button after the route name button
- Clicking sets `previewRoute: RouteStats | null = $state(null)` to the selected route
- `{#if previewRoute}` renders `<RouteMapModal polyline={previewRoute.sample_polyline} title={previewRoute.display_name} onclose={() => previewRoute = null} />`
- No map button for routes where `sample_polyline` is null

---

## Run Detail Page: Route Context

### Server (`frontend/src/routes/run/[id]/+page.server.ts`)

Extend `load()` to fetch route context in parallel:

```ts
const [activity, photos, allActivities, aliases] = await Promise.all([
  getActivity(params.id),
  getActivityPhotos(params.id),
  getAllActivities(),
  getRouteAliases(),
]);

const routes = computeRoutes(allActivities, aliases);
const routeContext = routes.find((r) => r.runs.some((run) => run.id === params.id)) ?? null;

return { activity, photos, routeContext };
```

### UI (`frontend/src/routes/run/[id]/+page.svelte`)

New "Route" section below the stats grid, shown only when `routeContext` is not null.

**Headline row:**
- Route name linked to `/stats` (anchor `#routes` if feasible, otherwise just `/stats`)
- Rank: "3rd of 12 runs"
- This run's time vs best: "54:01 · best 52:14" (or "— · best —" if no time)
- This run's pace vs best pace

**History table** (collapsed by default):
- Toggle button: "Show all 12 runs ▾" / "Hide ▴"
- Columns: Date · Time · Pace
- Current run row highlighted with `var(--accent)` text
- Each row links to `/run/{id}`

### Rank computation

Rank = position of this run's `time_s` among all runs in `routeContext.runs` that have a `time_s`, sorted ascending. Ties rank equally.

---

## File Map

| File | Change |
|---|---|
| `frontend/src/lib/stats.ts` | Add `RouteRun` interface, extend `RouteStats`, extend `ActivityForRoutes`, update `computeRoutes` |
| `frontend/src/lib/stats.test.ts` | Tests for `sample_polyline` and `runs` in `computeRoutes` output |
| `frontend/src/lib/components/RouteMapModal.svelte` | New modal component |
| `frontend/src/routes/stats/+page.svelte` | Add Map button + modal state |
| `frontend/src/routes/run/[id]/+page.server.ts` | Fetch all activities + compute route context |
| `frontend/src/routes/run/[id]/+page.svelte` | Add route context section |

---

## Out of Scope

- Showing multiple polylines (all runs overlaid on map)
- Filtering the history table
- Editing the route name from the run detail page
