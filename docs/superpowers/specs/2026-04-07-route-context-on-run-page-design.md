# Design: Route context on run detail page

**Date:** 2026-04-07  
**Status:** Approved

## Problem

The run detail page has a Route section in the frontend code, but it only renders when `routeContext` is non-null. `routeContext` is null for most runs because:

1. **Historical runs** (Runkeeper/Strava): fragmented into many geo-clusters due to GPS drift at the 3rd decimal place; `patch-route-names` and `name-routes` scripts are written but not yet applied to production.
2. **New app runs**: recorded via the internal app, arrive at `POST /run` without `route_name` set — there is no mechanism to match them to existing named routes.

Additionally, the existing Route section only shows a rank badge (`#X of Y timed runs`) and a comparison vs the all-time best. The user wants an explicit top-5 leaderboard instead.

## Scope

Three changes:

1. Route matching at ingest (webhook-listener)
2. One-time historical backfill (migrator scripts, deploy step)
3. Top-5 leaderboard on the run detail page (frontend)

---

## Section 1 — Route matching at ingest

**File:** `webhook-listener/src/route-matcher.ts` (new)  
**Triggered from:** `webhook-listener/src/routes/run.ts` — fire-and-forget after `upsertAppRun`

### Logic

1. Fetch all activities from Directus with `route_name` set: fields `route_name`, `summary_polyline`, `distance_m`.
2. Group by `route_name`. For each group, pick the representative polyline (longest string = most GPS detail).
3. Filter candidate routes: only those whose average `distance_m` is within ±10% of the new run's `distance_m`.
4. For each candidate, sample 24 evenly-spaced points from both polylines and compute the symmetric directed average Hausdorff distance (same algorithm as `migrator/src/find-similar-routes.ts`).
5. If the best match score ≤ 120m, PATCH `route_name` on the new activity in Directus.
6. If no match, do nothing — the run shows no route section (acceptable; can be manually named via admin UI later).

### Dependencies

- Add `@mapbox/polyline` to `webhook-listener/package.json` (already used in migrator).
- Uses the existing `directusFetch` pattern from `webhook-listener/src/directus.ts`.
- No shared library between migrator and webhook-listener — the geometry helpers (~40 lines) are duplicated. Acceptable for this codebase size.

### Error handling

- Wrapped in try/catch; failures are logged as `warn` and do not affect the HTTP response (already sent before this runs).
- Consistent with how `generateAndSaveHeadline` is handled.

### Threshold

120m — same default as `find-similar-routes.ts`. Can be adjusted if false positives/negatives are observed.

---

## Section 2 — Historical backfill

One-time deploy step. No code changes required — the scripts already exist and are fully configured.

**Order:**
```bash
cd migrator
npm run patch-route-names -- --apply   # merge known fragmented clusters
npm run name-routes -- --apply          # auto-name remaining geo-clusters
```

After this, historical Runkeeper/Strava runs will have `route_name` set in Directus and will show route context on their detail pages.

---

## Section 3 — Top-5 leaderboard on run detail page

**File:** `frontend/src/routes/run/[id]/+page.svelte`  
**No server-side changes required** — `routeContext.runs` already contains all runs for the route with `time_s` and `pace_s_km`.

### Display logic

- Filter `routeContext.runs` to those with `time_s != null`, sort by `time_s` ascending, take first 5.
- Render as a small table: rank (#1–#5), date (linked to `/run/{id}`), time, pace.
- Highlight the current run's row with `color: var(--accent)` (same as existing `.current-run` style).
- If the current run is outside the top 5: append a `…` separator row, then the current run's row showing its actual rank.
- Remove the existing `#routeRank of Y timed runs` badge — the table makes it redundant.
- The existing "All X runs" toggle and full history table remain unchanged below the top-5 table.

### Data already available

`routeContext.runs` is an array of `RouteRun` (`id`, `date`, `time_s`, `pace_s_km`). No additional Directus query needed.
