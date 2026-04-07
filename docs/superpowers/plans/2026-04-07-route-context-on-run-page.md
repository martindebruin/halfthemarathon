# Route Context on Run Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the route name and top-5 leaderboard on every run's detail page, and automatically assign a route name to new app runs at ingest time.

**Architecture:** New `route-matcher.ts` in webhook-listener performs polyline-based Hausdorff similarity matching against existing named routes after each app run arrives, then patches `route_name` on the activity in Directus. The frontend's existing `routeContext` pipeline is unchanged; the top-5 display is a pure template change to `+page.svelte`.

**Tech Stack:** `@mapbox/polyline` (polyline decode), Directus REST API (read + PATCH), SvelteKit 2 + Svelte 5 runes, vitest

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `webhook-listener/src/route-matcher.ts` | Geometry helpers + `matchAndAssignRoute` |
| Create | `webhook-listener/src/route-matcher.test.ts` | Unit tests for geometry + matching |
| Modify | `webhook-listener/package.json` | Add `@mapbox/polyline` dependency |
| Modify | `webhook-listener/src/routes/run.ts` | Fire-and-forget `matchAndAssignRoute` after upsert |
| Modify | `frontend/src/routes/run/[id]/+page.svelte` | Top-5 leaderboard, remove old rank badge |

---

## Task 1: route-matcher.ts — geometry + Directus integration

**Files:**
- Create: `webhook-listener/src/route-matcher.ts`
- Create: `webhook-listener/src/route-matcher.test.ts`
- Modify: `webhook-listener/package.json`

- [ ] **Step 1.1: Add @mapbox/polyline to webhook-listener/package.json**

Edit `webhook-listener/package.json`. Add to `"dependencies"`:
```json
"@mapbox/polyline": "^1.2.1"
```
Add to `"devDependencies"`:
```json
"@types/mapbox__polyline": "^1.0.5"
```

- [ ] **Step 1.2: Install dependencies**

```bash
cd webhook-listener && npm install
```

Expected: `@mapbox/polyline` and `@types/mapbox__polyline` appear in `node_modules`.

- [ ] **Step 1.3: Write failing tests**

Create `webhook-listener/src/route-matcher.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import polyline from '@mapbox/polyline';
import {
  haversineM,
  samplePolyline,
  routeSimilarity,
  sampleEncodedPolyline,
  matchAndAssignRoute,
} from './route-matcher.js';

type Point = [number, number];

afterEach(() => vi.unstubAllGlobals());

// ── Pure geometry ─────────────────────────────────────────────────────────────

describe('haversineM', () => {
  it('returns 0 for identical points', () => {
    expect(haversineM(59.368, 17.087, 59.368, 17.087)).toBe(0);
  });

  it('returns ~111 195m per degree of latitude', () => {
    const d = haversineM(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('samplePolyline', () => {
  it('returns empty array for empty input', () => {
    expect(samplePolyline([], 10)).toEqual([]);
  });

  it('returns all points when fewer than n', () => {
    const pts: Point[] = [[1, 0], [2, 0]];
    expect(samplePolyline(pts, 5)).toEqual(pts);
  });

  it('returns exactly n points for large input', () => {
    const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0] as Point);
    expect(samplePolyline(pts, 24)).toHaveLength(24);
  });

  it('always includes first and last point', () => {
    const pts: Point[] = Array.from({ length: 100 }, (_, i) => [i, 0] as Point);
    const sampled = samplePolyline(pts, 10);
    expect(sampled[0]).toEqual([0, 0]);
    expect(sampled[sampled.length - 1]).toEqual([99, 0]);
  });
});

describe('routeSimilarity', () => {
  it('returns 0 for identical point sets', () => {
    const pts: Point[] = [[59.368, 17.087], [59.370, 17.090]];
    expect(routeSimilarity(pts, pts)).toBe(0);
  });

  it('returns higher score for more different routes', () => {
    const a: Point[] = [[0, 0], [0.01, 0]];
    const same: Point[] = [[0, 0], [0.01, 0]];
    const far: Point[] = [[0, 1], [0.01, 1]]; // ~111km east
    expect(routeSimilarity(a, same)).toBeLessThan(routeSimilarity(a, far));
  });
});

describe('sampleEncodedPolyline', () => {
  it('returns at most SAMPLE_POINTS points', () => {
    // Long polyline: 50 collinear points along latitude
    const pts: Point[] = Array.from({ length: 50 }, (_, i) => [59 + i * 0.001, 17] as Point);
    const encoded = polyline.encode(pts);
    const sampled = sampleEncodedPolyline(encoded);
    expect(sampled.length).toBeLessThanOrEqual(24);
  });
});

// ── matchAndAssignRoute ───────────────────────────────────────────────────────

// Two test polylines: one near Stockholm, one near the equator
const STOCKHOLM_PTS: Point[] = [
  [59.368, 17.087], [59.370, 17.090], [59.372, 17.087], [59.370, 17.084],
];
const EQUATOR_PTS: Point[] = [
  [0, 0], [0, 0.1], [0, 0.2], [0, 0.1],
];
const STOCKHOLM_ENCODED = polyline.encode(STOCKHOLM_PTS);
const EQUATOR_ENCODED = polyline.encode(EQUATOR_PTS);

function makeDirectusResponse(rows: unknown[]) {
  return { ok: true, json: async () => ({ data: rows }) };
}
function makePatchResponse() {
  return { ok: true, json: async () => ({}) };
}

describe('matchAndAssignRoute', () => {
  it('patches route_name when polyline matches within threshold', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'Lundby_LötRygg_8km', summary_polyline: STOCKHOLM_ENCODED, distance_m: 8000 },
      ]))
      .mockResolvedValueOnce(makePatchResponse()),
    );

    await matchAndAssignRoute('act-001', STOCKHOLM_ENCODED, 8000);

    const fetchMock = vi.mocked(global.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const patchCall = fetchMock.mock.calls[1];
    expect(String(patchCall[0])).toContain('act-001');
    const body = JSON.parse((patchCall[1] as RequestInit).body as string);
    expect(body.route_name).toBe('Lundby_LötRygg_8km');
  });

  it('does not patch when polyline similarity exceeds threshold', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'FarRoute', summary_polyline: EQUATOR_ENCODED, distance_m: 8000 },
      ])),
    );

    await matchAndAssignRoute('act-002', STOCKHOLM_ENCODED, 8000);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1); // GET only, no PATCH
  });

  it('does not patch when distance differs by more than 10%', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([
        { route_name: 'Lundby_LötRygg_8km', summary_polyline: STOCKHOLM_ENCODED, distance_m: 10_000 },
      ])),
    );

    await matchAndAssignRoute('act-003', STOCKHOLM_ENCODED, 8000); // 8000 vs 10000 = 25% diff

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1); // GET only, no PATCH
  });

  it('does not patch when no named routes exist', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeDirectusResponse([])),
    );

    await matchAndAssignRoute('act-004', STOCKHOLM_ENCODED, 8000);

    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 1.4: Run tests to verify they fail**

```bash
cd webhook-listener && npm test -- --reporter=verbose 2>&1 | grep -E 'FAIL|PASS|haversineM|samplePolyline|routeSimilarity|matchAndAssignRoute'
```

Expected: all tests in `route-matcher.test.ts` fail with "Cannot find module" or similar.

- [ ] **Step 1.5: Implement route-matcher.ts**

Create `webhook-listener/src/route-matcher.ts`:

```typescript
import polyline from '@mapbox/polyline';

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const THRESHOLD_M = 120;
const SAMPLE_POINTS = 24;

type Point = [number, number]; // [lat, lng]

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function samplePolyline(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length <= n) return points;
  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * (points.length - 1));
    result.push(points[idx]);
  }
  return result;
}

function directedAvgHausdorff(a: Point[], b: Point[]): number {
  if (a.length === 0 || b.length === 0) return Infinity;
  let total = 0;
  for (const [la, lna] of a) {
    let minD = Infinity;
    for (const [lb, lnb] of b) {
      const d = haversineM(la, lna, lb, lnb);
      if (d < minD) minD = d;
    }
    total += minD;
  }
  return total / a.length;
}

export function routeSimilarity(a: Point[], b: Point[]): number {
  return (directedAvgHausdorff(a, b) + directedAvgHausdorff(b, a)) / 2;
}

export function sampleEncodedPolyline(encoded: string): Point[] {
  const decoded = polyline.decode(encoded) as Point[];
  return samplePolyline(decoded, SAMPLE_POINTS);
}

interface NamedRouteRow {
  route_name: string;
  summary_polyline: string;
  distance_m: number;
}

async function fetchNamedRoutes(): Promise<NamedRouteRow[]> {
  const url =
    `${DIRECTUS_URL}/items/activities?limit=-1` +
    `&filter[route_name][_nnull]=true` +
    `&fields=route_name,summary_polyline,distance_m`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` } });
  if (!res.ok) throw new Error(`Directus fetch failed ${res.status}`);
  const json = await res.json() as { data: NamedRouteRow[] };
  return json.data.filter((r) => r.summary_polyline);
}

async function patchRouteName(activityId: string, routeName: string): Promise<void> {
  const res = await fetch(`${DIRECTUS_URL}/items/activities/${activityId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ route_name: routeName }),
  });
  if (!res.ok) throw new Error(`PATCH route_name failed ${res.status}`);
}

export async function matchAndAssignRoute(
  activityId: string,
  encodedPolyline: string,
  distanceM: number,
): Promise<void> {
  const namedRoutes = await fetchNamedRoutes();
  if (namedRoutes.length === 0) return;

  // Group by route_name: pick longest polyline as representative, track avg distance
  const groups = new Map<string, { repPolyline: string; distances: number[] }>();
  for (const r of namedRoutes) {
    if (!groups.has(r.route_name)) {
      groups.set(r.route_name, { repPolyline: r.summary_polyline, distances: [] });
    }
    const g = groups.get(r.route_name)!;
    if (r.summary_polyline.length > g.repPolyline.length) g.repPolyline = r.summary_polyline;
    g.distances.push(r.distance_m);
  }

  const newSamples = sampleEncodedPolyline(encodedPolyline);
  if (newSamples.length < 3) return;

  let bestRouteName: string | null = null;
  let bestScore = Infinity;

  for (const [name, { repPolyline, distances }] of groups) {
    const avgDistM = distances.reduce((s, d) => s + d, 0) / distances.length;
    if (Math.abs(avgDistM - distanceM) / distanceM > 0.1) continue;

    const candidateSamples = sampleEncodedPolyline(repPolyline);
    if (candidateSamples.length < 3) continue;

    const score = routeSimilarity(newSamples, candidateSamples);
    if (score < bestScore) {
      bestScore = score;
      bestRouteName = name;
    }
  }

  if (bestRouteName !== null && bestScore <= THRESHOLD_M) {
    await patchRouteName(activityId, bestRouteName);
  }
}
```

- [ ] **Step 1.6: Run tests to verify they pass**

```bash
cd webhook-listener && npm test -- --reporter=verbose 2>&1 | grep -E 'FAIL|PASS|✓|✗'
```

Expected: all tests pass with no failures.

- [ ] **Step 1.7: Commit**

```bash
cd webhook-listener
git add package.json package-lock.json src/route-matcher.ts src/route-matcher.test.ts
git commit -m "feat: add polyline-based route matcher for app runs"
```

---

## Task 2: Wire route matching into run.ts

**Files:**
- Modify: `webhook-listener/src/routes/run.ts`

- [ ] **Step 2.1: Add import and fire-and-forget call**

In `webhook-listener/src/routes/run.ts`, add the import at the top:

```typescript
import { matchAndAssignRoute } from '../route-matcher.js';
```

Then inside the `runRouter.post('/')` handler, after the line `log('info', 'app_run_saved', ...)` and before `res.status(200).json(...)`, add the route-matching fire-and-forget alongside the existing headline one. The full updated handler body (replace from `try {` to the closing `}` of the catch):

```typescript
  try {
    log('info', 'app_run_received', { app_run_id: validation.payload.app_run_id });
    const activityId = await upsertAppRun(validation.payload);
    log('info', 'app_run_saved', { app_run_id: validation.payload.app_run_id });
    res.status(200).json({ status: 'ok' });

    // Fire-and-forget: generate headline after response is sent
    const p = validation.payload;
    generateAndSaveHeadline(
      activityId,
      p.started_at,
      p.start_lat ?? null,
      p.start_lng ?? null,
    ).catch(err => log('warn', 'headline_failed', { error: String(err) }));

    // Fire-and-forget: match to known route if polyline available
    if (p.summary_polyline && p.distance_m) {
      matchAndAssignRoute(activityId, p.summary_polyline, p.distance_m)
        .catch(err => log('warn', 'route_match_failed', { error: String(err) }));
    }
  } catch (err) {
    log('error', 'app_run_failed', { app_run_id: validation.payload.app_run_id, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
```

- [ ] **Step 2.2: Run tests to verify no regression**

```bash
cd webhook-listener && npm test -- --reporter=verbose 2>&1 | grep -E 'FAIL|PASS|✓|✗'
```

Expected: all tests still pass.

- [ ] **Step 2.3: Commit**

```bash
cd webhook-listener
git add src/routes/run.ts
git commit -m "feat: fire-and-forget route matching on app run ingest"
```

---

## Task 3: Frontend top-5 leaderboard

**Files:**
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 3.1: Add top5 and isInTop5 derived values to the script**

In `frontend/src/routes/run/[id]/+page.svelte`, inside the `<script>` block, add these two derived values after the existing `routeRank` derived (after line 39):

```typescript
  const top5 = $derived.by(() => {
    if (!data.routeContext) return [] as typeof data.routeContext.runs;
    return [...data.routeContext.runs]
      .filter((r) => r.time_s != null)
      .sort((a, b) => a.time_s! - b.time_s!)
      .slice(0, 5);
  });

  const isInTop5 = $derived(top5.some((r) => r.id === data.activity.id));
```

- [ ] **Step 3.2: Replace the route-context template block**

Replace the entire `{#if data.routeContext}` block (lines 143–193) with:

```svelte
      {#if data.routeContext}
        {@const rc = data.routeContext}
        <div class="route-context">
          <h2>Route</h2>
          <a href="/stats" class="route-name-link">{rc.display_name}</a>
          {#if top5.length > 0}
            <table class="route-history">
              <thead>
                <tr><th>#</th><th>Date</th><th>Time</th><th>Pace</th></tr>
              </thead>
              <tbody>
                {#each top5 as run, i (run.id)}
                  <tr class:current-run={run.id === data.activity.id}>
                    <td>{i + 1}</td>
                    <td><a href="/run/{run.id}">{run.date.slice(0, 10)}</a></td>
                    <td>{run.time_s != null ? formatDuration(run.time_s) : '—'}</td>
                    <td>{run.pace_s_km != null ? fmtPace(run.pace_s_km) : '—'}</td>
                  </tr>
                {/each}
                {#if !isInTop5 && thisRouteRun != null && routeRank != null}
                  <tr><td colspan="4" class="ellipsis-row">…</td></tr>
                  <tr class="current-run">
                    <td>{routeRank}</td>
                    <td><a href="/run/{data.activity.id}">{data.activity.date.slice(0, 10)}</a></td>
                    <td>{thisRouteRun.time_s != null ? formatDuration(thisRouteRun.time_s) : '—'}</td>
                    <td>{thisRouteRun.pace_s_km != null ? fmtPace(thisRouteRun.pace_s_km) : '—'}</td>
                  </tr>
                {/if}
              </tbody>
            </table>
          {/if}
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

- [ ] **Step 3.3: Update the CSS block**

In the `<style>` block, remove the now-dead rules and add `.ellipsis-row`. Replace the route-context CSS section (from `.route-context {` to `.route-history a:hover { text-decoration: underline; }`) with:

```css
  .route-context { margin-top: 1.5rem; }
  .route-context h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.5rem; }
  .route-name-link { display: block; font-weight: 500; color: var(--text); margin-bottom: 0.75rem; }
  .route-name-link:hover { color: var(--accent); }
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
  .route-history { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 0.75rem; }
  .route-history th { text-align: left; padding: 0.4rem 0.5rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  .route-history td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); }
  .route-history tr.current-run td { color: var(--accent); }
  .route-history a { color: inherit; }
  .route-history a:hover { text-decoration: underline; }
  .ellipsis-row { text-align: center; color: var(--muted); letter-spacing: 0.1em; }
```

- [ ] **Step 3.4: Run svelte-check to verify no type errors**

```bash
cd frontend && npm run check 2>&1 | tail -20
```

Expected: `0 errors` (warnings about unused CSS are acceptable if any appear).

- [ ] **Step 3.5: Commit**

```bash
cd frontend
git add src/routes/run/\[id\]/+page.svelte
git commit -m "feat: show top-5 route leaderboard on run detail page"
```

---

## Task 4: Historical backfill (deploy step)

No code changes. Run the existing migrator scripts against production.

**Prerequisites:** `migrator/.env` (or environment) must point `DIRECTUS_INTERNAL_URL` or `DIRECTUS_PUBLIC_URL` at the production Directus instance, with a valid `DIRECTUS_TOKEN`.

- [ ] **Step 4.1: Dry-run patch-route-names to verify output**

```bash
cd migrator && npm run patch-route-names
```

Expected output: each line shows either `[skip]` (already correct) or `[merge]` with the activities that will be updated. Verify the counts look sane (no unexpectedly large numbers).

- [ ] **Step 4.2: Apply patch-route-names**

```bash
cd migrator && npm run patch-route-names -- --apply
```

Expected: `[merge]` lines followed by `Done.`

- [ ] **Step 4.3: Dry-run name-routes to verify output**

```bash
cd migrator && npm run name-routes
```

Expected: a list of remaining unnamed geo-clusters with their auto-generated names. Scan for anything obviously wrong (e.g. place names that don't match the location).

- [ ] **Step 4.4: Apply name-routes**

```bash
cd migrator && npm run name-routes -- --apply
```

Expected: `Done.`

- [ ] **Step 4.5: Verify on the live site**

Open a run that was previously showing no Route section. Confirm the Route section now appears with the route name and top-5 table.
