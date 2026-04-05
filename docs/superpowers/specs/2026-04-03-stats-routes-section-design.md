# Stats Page — Routes Section

**Date:** 2026-04-03  
**Status:** Approved

---

## Overview

Add a "Routes" section to the stats page (`/stats`) showing per-route stats: how many times a route has been run, the best recorded time, and the best pace. Route names can be renamed inline in the UI, with the rename persisted for all runs matching that route.

---

## Route Identity & Clustering

Each activity is assigned a `cluster_key` deterministically:

- **Named route** (`route_name` is set): `name:${route_name}`
- **Unnamed** (`route_name` is null, but `start_lat`, `start_lng`, and `distance_m` are present):
  `geo:${start_lat.toFixed(3)}_${start_lng.toFixed(3)}_${Math.round(distance_m / 1000)}km`
  - lat/lng to 3 decimal places ≈ ±100m grid, satisfying the ~200m proximity goal
  - distance bucketed to nearest 1km (e.g. 9.8km and 10.2km land in the same bucket)
- **Excluded**: activities missing `start_lat`, `start_lng`, or `distance_m` with no `route_name`

The default display name for a cluster is `route_name` if set, otherwise the most common activity `name` within that cluster.

Routes with only 1 run are included but visually de-emphasised.

---

## Data Model

### New Directus collection: `route_aliases`

Added via `migrator/src/setup-schema.ts` (idempotent).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `cluster_key` | string | unique, indexed |
| `display_name` | string | custom name override |

Upserted on `cluster_key` when a user renames a route.

---

## Backend Changes

### `frontend/src/lib/server/directus.ts`

1. Add `start_lat`, `start_lng` to the fields list in `getAllActivities()`.
2. New `getRouteAliases()` function returning `Array<{ cluster_key: string; display_name: string }>`.

### `frontend/src/routes/stats/+page.server.ts`

New `computeRoutes()` helper:
1. Assigns each activity a `cluster_key`.
2. Accumulates per cluster: run count, best pace (highest m/s → lowest s/km), best time (shortest `moving_time_s` among runs within 10% of the cluster's median distance).
3. Merges aliases to produce final display names.
4. Returns array sorted by run count descending.

`load()` fetches `getRouteAliases()` in parallel with existing queries and adds `routes` to the returned data.

### New API route: `frontend/src/routes/api/routes/rename/+server.ts`

`POST { cluster_key: string, display_name: string }`  
Upserts a `route_aliases` record in Directus via `directusFetch`. Returns 200 on success.

---

## UI Changes

### `frontend/src/routes/stats/+page.svelte`

New section below "Personal records":

```
Routes
──────────────────────────────────────────────────────
Route            Runs   Best time   Best pace
Djurgården Loop   47    52:14       5:13 /km
Afternoon Run      3    48:02       4:48 /km
...
──────────────────────────────────────────────────────
```

- Table layout, consistent with the Personal bests table.
- Route name cell: clicking it replaces text with an `<input>`. Blur or Enter commits — POSTs to `/api/routes/rename`, then calls `invalidateAll()` to revalidate.
- Routes with 1 run: count shown in `var(--muted)`.

---

## Out of Scope

- Merging two separate clusters into one route (the rename only changes the display name, not the cluster key).
- Map visualisation of routes.
- Filtering or searching routes.
