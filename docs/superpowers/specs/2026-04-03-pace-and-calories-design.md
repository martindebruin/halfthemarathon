# Pace Display and Calorie Backfill Design

**Goal:** Show average pace for every run that has distance and time, and fix the 2 activities where `calories = 0`.

**Architecture:** Two independent, minimal changes. Pace is a pure frontend fix — compute `distance_m / moving_time_s` as a fallback when `average_speed` is null. Calories are fixed by a one-shot migrator script that patches the 2 zero-calorie activities using the ACSM running equation.

**Tech Stack:** SvelteKit (frontend utility + page components), Node.js/TypeScript migrator script following the existing `patch-polylines.ts` pattern.

---

## Scope

### Part 1 — Pace (frontend only)

- 802 Runkeeper activities have `average_speed = null` but have `distance_m` and `moving_time_s`
- `formatPace` already works correctly when given a speed in m/s
- Fix: add `computedSpeed(distance_m, moving_time_s): number | null` to `src/lib/utils.ts`
- In every place that calls `formatPace(activity.average_speed)`, change to `formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))`
- Affected files: `src/routes/+page.svelte`, `src/routes/[year]/+page.svelte`, `src/routes/run/[id]/+page.svelte`
- No DB writes, no migration

### Part 2 — Calorie backfill (migrator script)

- 2 activities have `calories = 0` (Strava source, API returned 0)
- All 802 Runkeeper activities already have calories from Runkeeper export — keep them unchanged
- Formula: ACSM running equation (flat ground), using Martin's stats: 82 kg
  ```
  speed_m_per_min = distance_m / (moving_time_s / 60)
  VO2_ml_kg_min   = 0.2 × speed_m_per_min + 3.5
  calories        = VO2_ml_kg_min × 82 × (moving_time_s / 60) × 0.005
  ```
- Filter: `calories = 0 AND distance_m IS NOT NULL AND moving_time_s IS NOT NULL`
- Create: `migrator/src/patch-calories.ts`
- Add script entry `"patch-calories": "tsx src/patch-calories.ts"` to `migrator/package.json`
- No new dependencies needed

## Files

- Modify: `frontend/src/lib/utils.ts` — add `computedSpeed()`
- Modify: `frontend/src/routes/+page.svelte` — use computed speed fallback
- Modify: `frontend/src/routes/[year]/+page.svelte` — use computed speed fallback
- Modify: `frontend/src/routes/run/[id]/+page.svelte` — use computed speed fallback
- Create: `migrator/src/patch-calories.ts` — patches activities where calories = 0
- Modify: `migrator/package.json` — add `patch-calories` script entry
