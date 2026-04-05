# Pace Display and Calorie Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show average pace for every run that has distance and time, and fix the 2 activities where `calories = 0`.

**Architecture:** Two independent changes. Part 1 is pure frontend: add a `computedSpeed()` utility that derives m/s from distance + time, then thread it as a fallback wherever `formatPace` is called. Part 2 is a one-shot migrator script that queries Directus for `calories = 0`, applies the ACSM running equation (82 kg), and PATCHes those records.

**Tech Stack:** SvelteKit/TypeScript (frontend), Node.js/TypeScript + tsx (migrator), Directus REST API, vitest (tests in both workspaces).

---

## File Structure

- Modify: `frontend/src/lib/utils.ts` — add `computedSpeed()`
- Create: `frontend/src/lib/utils.test.ts` — unit tests for `computedSpeed()`
- Modify: `frontend/src/routes/+page.svelte` — use `computedSpeed` fallback in pace display
- Modify: `frontend/src/routes/[year]/+page.server.ts` — use `computedSpeed` in fastest-pace logic
- Modify: `frontend/src/routes/[year]/+page.svelte` — use `computedSpeed` fallback in pace display and fastest highlight
- Modify: `frontend/src/routes/run/[id]/+page.svelte` — use `computedSpeed` fallback in pace stat
- Create: `migrator/src/patch-calories.ts` — one-shot script to fix activities with `calories = 0`
- Modify: `migrator/package.json` — add `patch-calories` script entry

---

### Task 1: Add `computedSpeed` utility + tests

**Context:** `frontend/src/lib/utils.ts` already exports `formatPace(speed: number | null)` which takes m/s and returns a string like `"5:30 /km"`. The fix is to compute `distance_m / moving_time_s` when `average_speed` is null. There is already a test file at `frontend/src/lib/stats.test.ts` using vitest as a model.

**Files:**
- Modify: `frontend/src/lib/utils.ts`
- Create: `frontend/src/lib/utils.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computedSpeed } from './utils.js';

describe('computedSpeed', () => {
  it('returns distance_m / moving_time_s', () => {
    // 5000m in 1500s = 3.333... m/s
    expect(computedSpeed(5000, 1500)).toBeCloseTo(3.333, 3);
  });

  it('returns null when distance is null', () => {
    expect(computedSpeed(null, 1500)).toBeNull();
  });

  it('returns null when time is null', () => {
    expect(computedSpeed(5000, null)).toBeNull();
  });

  it('returns null when distance is 0', () => {
    expect(computedSpeed(0, 1500)).toBeNull();
  });

  it('returns null when time is 0', () => {
    expect(computedSpeed(5000, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npm test -- utils.test.ts
```

Expected: FAIL with `computedSpeed is not a function` or similar import error.

- [ ] **Step 3: Add `computedSpeed` to `frontend/src/lib/utils.ts`**

Add this function at the end of `frontend/src/lib/utils.ts` (after `polylineToSvgPath`):

```ts
export function computedSpeed(distance_m: number | null, moving_time_s: number | null): number | null {
  if (!distance_m || !moving_time_s) return null;
  return distance_m / moving_time_s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npm test -- utils.test.ts
```

Expected: 5 tests passing.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat: add computedSpeed utility for Runkeeper pace fallback"
```

---

### Task 2: Update run list page

**Context:** `frontend/src/routes/+page.svelte` line 100 shows `{formatPace(activity.average_speed)}`. Runkeeper activities have `average_speed = null` so this renders `—`. The fix is to pass the computed fallback. The `computedSpeed` import is added to the existing import line.

**Files:**
- Modify: `frontend/src/routes/+page.svelte`

- [ ] **Step 1: Update the import line**

In `frontend/src/routes/+page.svelte`, change line 3:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath } from '$lib/utils.js';
```

to:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath, computedSpeed } from '$lib/utils.js';
```

- [ ] **Step 2: Update the pace display**

In `frontend/src/routes/+page.svelte`, change line 100:

```svelte
<span class="stat">{formatPace(activity.average_speed)}</span>
```

to:

```svelte
<span class="stat">{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</span>
```

- [ ] **Step 3: Verify locally**

```bash
cd frontend && npm run dev
```

Open http://localhost:5173 and verify that run cards now show pace (e.g. `5:30 /km`) instead of `—` for Runkeeper activities. The one Strava activity should be unchanged.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/routes/+page.svelte
git commit -m "feat: show computed pace on run list for Runkeeper activities"
```

---

### Task 3: Update year page (server + template)

**Context:** Two files need updating for the year page:

1. `frontend/src/routes/[year]/+page.server.ts` — the "fastest pace" highlight is computed server-side. Lines 17–20 filter and reduce using `a.average_speed` directly, which excludes all Runkeeper activities (they have null speed). Must update to use the computed fallback.

2. `frontend/src/routes/[year]/+page.svelte` — line 37 and 67 show `formatPace(...)` in the template using `average_speed` directly.

**Files:**
- Modify: `frontend/src/routes/[year]/+page.server.ts`
- Modify: `frontend/src/routes/[year]/+page.svelte`

- [ ] **Step 1: Update `+page.server.ts` imports**

In `frontend/src/routes/[year]/+page.server.ts`, add `computedSpeed` to the import on line 1:

```ts
import { getAllActivities } from '$lib/server/directus.js';
import { computedSpeed } from '$lib/utils.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
```

- [ ] **Step 2: Update the fastest-pace logic in `+page.server.ts`**

Replace lines 17–20:

```ts
const qualified = activities.filter((a) => (a.distance_m ?? 0) >= 5000 && a.average_speed);
const fastest = qualified.length > 0
  ? qualified.reduce((best, a) => (a.average_speed ?? 0) > (best.average_speed ?? 0) ? a : best)
  : null;
```

with:

```ts
const qualified = activities.filter((a) =>
  (a.distance_m ?? 0) >= 5000 &&
  (a.average_speed ?? computedSpeed(a.distance_m, a.moving_time_s))
);
const fastest = qualified.length > 0
  ? qualified.reduce((best, a) => {
      const aSpeed = a.average_speed ?? computedSpeed(a.distance_m, a.moving_time_s) ?? 0;
      const bestSpeed = best.average_speed ?? computedSpeed(best.distance_m, best.moving_time_s) ?? 0;
      return aSpeed > bestSpeed ? a : best;
    })
  : null;
```

- [ ] **Step 3: Update pace display in `+page.svelte` (card grid)**

In `frontend/src/routes/[year]/+page.svelte`, change the import on line 3:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath } from '$lib/utils.js';
```

to:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath, computedSpeed } from '$lib/utils.js';
```

- [ ] **Step 4: Update the card pace display**

In `frontend/src/routes/[year]/+page.svelte`, change line 67:

```svelte
<span>{formatPace(activity.average_speed)}</span>
```

to:

```svelte
<span>{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</span>
```

- [ ] **Step 5: Update the fastest-pace highlight**

In `frontend/src/routes/[year]/+page.svelte`, change line 37:

```svelte
<a href="/run/{data.fastest.id}" class="hl-link">{formatPace(data.fastest.average_speed)} /km — {formatDate(data.fastest.date)}</a>
```

to:

```svelte
<a href="/run/{data.fastest.id}" class="hl-link">{formatPace(data.fastest.average_speed ?? computedSpeed(data.fastest.distance_m, data.fastest.moving_time_s))} — {formatDate(data.fastest.date)}</a>
```

Note: removed the trailing ` /km` since `formatPace` already includes `/km` in its return value.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/routes/\[year\]/+page.server.ts src/routes/\[year\]/+page.svelte
git commit -m "feat: show computed pace on year page and include Runkeeper runs in fastest-pace highlight"
```

---

### Task 4: Update run detail page

**Context:** `frontend/src/routes/run/[id]/+page.svelte` line 59 shows `{formatPace(activity.average_speed)}` in the stats grid. Same fix as the other pages.

**Files:**
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 1: Update the import line**

In `frontend/src/routes/run/[id]/+page.svelte`, change line 3:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, formatHeartRate } from '$lib/utils.js';
```

to:

```svelte
import { formatDistance, formatPace, formatDate, formatDuration, formatHeartRate, computedSpeed } from '$lib/utils.js';
```

- [ ] **Step 2: Update the pace stat display**

In `frontend/src/routes/run/[id]/+page.svelte`, change line 59:

```svelte
<div class="value">{formatPace(activity.average_speed)}</div>
```

to:

```svelte
<div class="value">{formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))}</div>
```

- [ ] **Step 3: Run the full test suite**

```bash
cd frontend && npm test
```

Expected: all tests pass (stats.test.ts + utils.test.ts).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/routes/run/\[id\]/+page.svelte
git commit -m "feat: show computed pace on run detail page for Runkeeper activities"
```

---

### Task 5: Deploy frontend

**Context:** All four frontend files have been updated. Deploy with rsync + docker compose rebuild, same as always.

**Files:** None (deployment only)

- [ ] **Step 1: Rsync to server**

```bash
rsync -av --exclude node_modules --exclude .svelte-kit --exclude .env \
  /home/martin/dev/halfTheMarathon/frontend/ \
  dedibox1:/home/martin/dockers/halfthemarathon/frontend/
```

- [ ] **Step 2: Rebuild and restart**

```bash
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d frontend"
```

- [ ] **Step 3: Smoke test**

```bash
curl -s https://halfthemarathoniusedtobe.martindebruin.se/ | grep -c 'km'
```

Then open a Runkeeper run (e.g. https://halfthemarathoniusedtobe.martindebruin.se/run/222) and verify the "Avg pace" stat shows a value like `6:17 /km` instead of `—`.

---

### Task 6: Calorie backfill script

**Context:** 2 activities have `calories = 0` (Strava source). All 802 Runkeeper activities already have correct calories from the Runkeeper export — those are not touched. The ACSM running equation on flat ground needs only `distance_m` and `moving_time_s`, both of which are present for all activities. Follow the exact same pattern as `migrator/src/patch-polylines.ts`: fetch from Directus, compute, PATCH.

Calorie formula verification (use the existing 5km run at run/222 as a sanity check):
- 5010m, 1889s → speed = 159.2 m/min → VO2 = 35.34 → calories = 35.34 × 82 × 31.48 × 0.005 ≈ 456 kcal
- Runkeeper reported 464 kcal for that run — within 2%, formula is correct.

**Files:**
- Create: `migrator/src/patch-calories.ts`
- Modify: `migrator/package.json`

- [ ] **Step 1: Add the script to `migrator/package.json`**

In `migrator/package.json`, add `"patch-calories"` to the `"scripts"` block:

```json
{
  "name": "htmitub-migrator",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "oauth": "tsx src/oauth.ts",
    "test-strava": "tsx src/strava-test.ts",
    "validate": "tsx src/validate.ts",
    "setup-schema": "tsx src/setup-schema.ts",
    "migrate": "tsx src/index.ts",
    "migrate:dry": "tsx src/index.ts --dry-run",
    "test": "vitest run",
    "backfill": "tsx src/backfill.ts",
    "patch-polylines": "tsx src/patch-polylines.ts",
    "patch-calories": "tsx src/patch-calories.ts"
  },
  ...
}
```

- [ ] **Step 2: Create `migrator/src/patch-calories.ts`**

```ts
import 'dotenv/config';

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

/**
 * ACSM running equation (flat ground).
 * speed_m_per_min = distance_m / (moving_time_s / 60)
 * VO2_ml_kg_min   = 0.2 * speed_m_per_min + 3.5
 * calories        = VO2_ml_kg_min * WEIGHT_KG * duration_min * 0.005
 */
function estimateCalories(distance_m: number, moving_time_s: number): number {
  const WEIGHT_KG = 82;
  const duration_min = moving_time_s / 60;
  const speed_m_per_min = distance_m / duration_min;
  const vo2_ml_kg_min = 0.2 * speed_m_per_min + 3.5;
  return Math.round(vo2_ml_kg_min * WEIGHT_KG * duration_min * 0.005);
}

async function main() {
  console.log('Fetching activities with calories = 0...');
  const result = await directusFetch(
    '/items/activities?filter[calories][_eq]=0&filter[distance_m][_nnull]=true&filter[moving_time_s][_nnull]=true&fields=id,distance_m,moving_time_s&limit=-1'
  ) as { data: Array<{ id: string; distance_m: number; moving_time_s: number }> };

  const toUpdate = result.data;
  console.log(`Found ${toUpdate.length} activities to patch`);

  if (toUpdate.length === 0) {
    console.log('Nothing to patch.');
    return;
  }

  let patched = 0;
  let errors = 0;

  for (const activity of toUpdate) {
    const calories = estimateCalories(activity.distance_m, activity.moving_time_s);
    console.log(`  Activity ${activity.id}: ${activity.distance_m}m / ${activity.moving_time_s}s → ${calories} kcal`);

    try {
      await directusFetch(`/items/activities/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ calories }),
      });
      patched++;
    } catch (err) {
      errors++;
      console.error(`Error patching activity ${activity.id}:`, err);
    }
  }

  console.log(`\nDone. ${patched} patched, ${errors} errors`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Run the script (dry-run check first)**

First verify it finds the right activities without patching — run once and read the output before the PATCH goes through. The script logs what it's about to patch before patching.

```bash
cd migrator && npm run patch-calories
```

Expected output:
```
Fetching activities with calories = 0...
Found 2 activities to patch
  Activity 803: 8079.4m / 3326s → 649 kcal
  Activity <id>: ...m / ...s → ... kcal
Done. 2 patched, 0 errors
```

- [ ] **Step 4: Verify in Directus**

```bash
# Check that no activities with calories = 0 remain
curl -s "http://0.0.0.0:8055/items/activities?filter[calories][_eq]=0&aggregate[count]=id" \
  -H "Authorization: Bearer $(grep DIRECTUS_TOKEN .env | cut -d= -f2)"
```

Expected: `{"data":[{"count":{"id":0}}]}`

- [ ] **Step 5: Commit**

```bash
cd ..  # back to repo root
git add migrator/src/patch-calories.ts migrator/package.json
git commit -m "feat: add calorie backfill script using ACSM formula for activities with calories=0"
```
