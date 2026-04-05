# GPX Polyline Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse GPX files from the Runkeeper export and backfill `summary_polyline`, `start_lat`, and `start_lng` on all 802 Runkeeper activities in Directus so the RunMap component renders their routes.

**Architecture:** Add a `parseGpxToPolyline` function to `migrator/src/gpx.ts` that reads a GPX file, extracts trackpoints via regex, subsamples to ≤500 points, and returns a Google Encoded Polyline string. A new standalone script `patch-polylines.ts` reads the CSV to build a `runkeeperActivityId → gpxFilename` map, queries Directus for activities missing `summary_polyline`, and PATCHes each one. The frontend `RunMap` component already handles Google Encoded Polyline — no frontend changes needed.

**Tech Stack:** TypeScript/tsx, `@mapbox/polyline` (encoding), vitest (tests), Directus REST API, Node.js `fs` + regex for GPX parsing.

---

## File Structure

- **Modify:** `migrator/src/gpx.ts` — add `extractTrackpoints(content)` and `parseGpxToPolyline(filePath)`
- **Create:** `migrator/src/gpx.test.ts` — unit tests for GPX parsing and subsampling
- **Create:** `migrator/src/patch-polylines.ts` — standalone Directus patch script
- **Modify:** `migrator/package.json` — add `@mapbox/polyline` and `@types/mapbox__polyline`

---

### Task 1: Add @mapbox/polyline dependency

**Files:**
- Modify: `migrator/package.json`

- [ ] **Step 1: Install the dependency**

Run from `migrator/`:
```bash
npm install @mapbox/polyline
npm install --save-dev @types/mapbox__polyline
```

Expected: `package.json` `dependencies` gains `"@mapbox/polyline": "^1.x.x"` and `devDependencies` gains `"@types/mapbox__polyline"`.

- [ ] **Step 2: Verify import works**

```bash
node --input-type=module <<'EOF'
import polyline from '@mapbox/polyline';
const encoded = polyline.encode([[57.0, 11.0], [57.001, 11.001]]);
console.log('ok', encoded.length > 0);
EOF
```

Expected: `ok true`

- [ ] **Step 3: Commit**

```bash
cd migrator
git add package.json package-lock.json
git commit -m "feat: add @mapbox/polyline to migrator"
```

---

### Task 2: Add GPX parsing functions to gpx.ts

**Files:**
- Modify: `migrator/src/gpx.ts`

Current `gpx.ts` only has `resolveGpxPath`. We add two functions.

`extractTrackpoints` is pure (takes string content) to make it testable without file I/O.

- [ ] **Step 1: Write the failing test first** (see Task 3 — write test, then implement)

Skip to Task 3 step 1, then come back here.

- [ ] **Step 2: Replace `migrator/src/gpx.ts` with this full content**

```typescript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import polyline from '@mapbox/polyline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(__dirname, '../..');
const ROUTES_DIR = path.join(DATA_ROOT, 'routes');
const RECOVERED_DIR = path.join(DATA_ROOT, 'recovered');

export function resolveGpxPath(filename: string): string | null {
  if (!filename) return null;
  const inRoutes = path.join(ROUTES_DIR, filename);
  if (fs.existsSync(inRoutes)) return inRoutes;
  const inRecovered = path.join(RECOVERED_DIR, filename);
  if (fs.existsSync(inRecovered)) return inRecovered;
  return null;
}

const MAX_TRACKPOINTS = 500;

/**
 * Extracts [lat, lng] pairs from GPX XML content.
 * Subsamples to MAX_TRACKPOINTS if the track is longer.
 */
export function extractTrackpoints(content: string): [number, number][] {
  const matches = [...content.matchAll(/<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g)];
  const all: [number, number][] = matches.map((m) => [parseFloat(m[1]), parseFloat(m[2])]);

  if (all.length === 0) return [];
  if (all.length <= MAX_TRACKPOINTS) return all;

  const step = Math.ceil(all.length / MAX_TRACKPOINTS);
  const sampled = all.filter((_, i) => i % step === 0);
  // Always include the last point
  if (sampled[sampled.length - 1] !== all[all.length - 1]) {
    sampled.push(all[all.length - 1]);
  }
  return sampled;
}

/**
 * Reads a GPX file and returns a Google Encoded Polyline plus start coordinates.
 * Returns null if the file has no trackpoints.
 */
export function parseGpxToPolyline(
  filePath: string
): { polyline: string; startLat: number; startLng: number } | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const points = extractTrackpoints(content);
  if (points.length === 0) return null;

  return {
    polyline: polyline.encode(points),
    startLat: points[0][0],
    startLng: points[0][1],
  };
}
```

- [ ] **Step 3: Run the tests (written in Task 3)**

```bash
cd migrator && npm test
```

Expected: all tests in `gpx.test.ts` pass.

- [ ] **Step 4: Commit**

```bash
git add migrator/src/gpx.ts
git commit -m "feat: add GPX trackpoint extraction and polyline encoding"
```

---

### Task 3: Write unit tests for GPX parsing

**Files:**
- Create: `migrator/src/gpx.test.ts`

Do this before implementing (TDD). The test imports `extractTrackpoints` which doesn't exist yet — it will fail until Task 2 step 2 is done.

- [ ] **Step 1: Create `migrator/src/gpx.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { extractTrackpoints } from './gpx.js';

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
<trk><trkseg>
<trkpt lat="57.000000" lon="11.000000"><ele>10.0</ele></trkpt>
<trkpt lat="57.001000" lon="11.001000"><ele>11.0</ele></trkpt>
<trkpt lat="57.002000" lon="11.002000"><ele>12.0</ele></trkpt>
</trkseg></trk>
</gpx>`;

describe('extractTrackpoints', () => {
  it('parses lat/lng from GPX content', () => {
    const points = extractTrackpoints(SAMPLE_GPX);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual([57.0, 11.0]);
    expect(points[1]).toEqual([57.001, 11.001]);
    expect(points[2]).toEqual([57.002, 11.002]);
  });

  it('returns empty array for GPX with no trackpoints', () => {
    expect(extractTrackpoints('<gpx></gpx>')).toEqual([]);
  });

  it('subsamples when there are more than 500 points', () => {
    // Build a GPX string with 1000 trackpoints
    const trkpts = Array.from({ length: 1000 }, (_, i) =>
      `<trkpt lat="${(57 + i * 0.0001).toFixed(4)}" lon="${(11 + i * 0.0001).toFixed(4)}"></trkpt>`
    ).join('\n');
    const gpx = `<gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;

    const points = extractTrackpoints(gpx);
    expect(points.length).toBeLessThanOrEqual(500);
    // First point is always included
    expect(points[0][0]).toBeCloseTo(57.0, 3);
    // Last point is always included
    expect(points[points.length - 1][0]).toBeCloseTo(57 + 999 * 0.0001, 3);
  });

  it('returns all points when count is exactly 500', () => {
    const trkpts = Array.from({ length: 500 }, (_, i) =>
      `<trkpt lat="${(57 + i * 0.0001).toFixed(4)}" lon="${(11 + i * 0.0001).toFixed(4)}"></trkpt>`
    ).join('\n');
    const gpx = `<gpx><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
    const points = extractTrackpoints(gpx);
    expect(points).toHaveLength(500);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd migrator && npm test -- gpx
```

Expected: FAIL — `extractTrackpoints is not exported from ./gpx.js`

- [ ] **Step 3: Implement (Task 2 step 2), then run again**

```bash
cd migrator && npm test -- gpx
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add migrator/src/gpx.test.ts
git commit -m "test: add unit tests for GPX trackpoint extraction"
```

---

### Task 4: Create the patch-polylines script

**Files:**
- Create: `migrator/src/patch-polylines.ts`
- Modify: `migrator/package.json` (add `patch-polylines` script entry)

This script:
1. Reads `recovered/cardioActivities.csv` to build a `runkeeperActivityId → gpxFilename` map
2. Queries Directus for all activities where `runkeeper_id` is not null and `summary_polyline` is null
3. For each, resolves the GPX file, parses it, PATCHes the Directus record
4. Logs progress and final counts

Environment required (already in `migrator/.env`):
- `DIRECTUS_PUBLIC_URL` or `DIRECTUS_INTERNAL_URL` pointing to Directus
- `DIRECTUS_TOKEN` with write access

- [ ] **Step 1: Create `migrator/src/patch-polylines.ts`**

```typescript
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCardioActivities } from './parse.js';
import { resolveGpxPath, parseGpxToPolyline } from './gpx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(ROOT, 'recovered');
const CSV_PATH = path.join(RECOVERED_DIR, 'cardioActivities.csv');

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

async function main() {
  // Build map: runkeeperActivityId → gpxFilename
  console.log('Reading CSV...');
  const activities = parseCardioActivities(CSV_PATH);
  const gpxMap = new Map<string, string>();
  for (const a of activities) {
    if (a.gpxFile) gpxMap.set(a.activityId, a.gpxFile);
  }
  console.log(`CSV has ${gpxMap.size} activities with GPX files`);

  // Fetch all Runkeeper activities in Directus that are missing a polyline
  console.log('Fetching activities from Directus...');
  const result = await directusFetch(
    '/items/activities?filter[runkeeper_id][_nnull]=true&filter[summary_polyline][_null]=true&fields=id,runkeeper_id&limit=-1'
  ) as { data: Array<{ id: string; runkeeper_id: string }> };

  const toUpdate = result.data;
  console.log(`Found ${toUpdate.length} activities to patch`);

  let patched = 0;
  let skipped = 0;
  let errors = 0;

  for (const activity of toUpdate) {
    const gpxFilename = gpxMap.get(activity.runkeeper_id);
    if (!gpxFilename) {
      skipped++;
      continue;
    }

    const gpxPath = resolveGpxPath(gpxFilename);
    if (!gpxPath) {
      skipped++;
      continue;
    }

    try {
      const parsed = parseGpxToPolyline(gpxPath);
      if (!parsed) {
        skipped++;
        continue;
      }

      await directusFetch(`/items/activities/${activity.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          summary_polyline: parsed.polyline,
          start_lat: parsed.startLat,
          start_lng: parsed.startLng,
        }),
      });

      patched++;
      if (patched % 50 === 0) {
        console.log(`  ${patched} patched, ${skipped} skipped, ${errors} errors`);
      }
    } catch (err) {
      errors++;
      console.error(`Error patching activity ${activity.id} (runkeeper_id ${activity.runkeeper_id}):`, err);
    }
  }

  console.log(`\nDone. ${patched} patched, ${skipped} skipped (no GPX), ${errors} errors`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add script entry to `migrator/package.json`**

Add to the `"scripts"` block:
```json
"patch-polylines": "tsx src/patch-polylines.ts"
```

The scripts section should look like:
```json
"scripts": {
  "oauth": "tsx src/oauth.ts",
  "test-strava": "tsx src/strava-test.ts",
  "validate": "tsx src/validate.ts",
  "setup-schema": "tsx src/setup-schema.ts",
  "migrate": "tsx src/index.ts",
  "migrate:dry": "tsx src/index.ts --dry-run",
  "test": "vitest run",
  "backfill": "tsx src/backfill.ts",
  "patch-polylines": "tsx src/patch-polylines.ts"
},
```

- [ ] **Step 3: Commit**

```bash
git add migrator/src/patch-polylines.ts migrator/package.json
git commit -m "feat: add patch-polylines script to backfill GPX routes into Directus"
```

---

### Task 5: Run the patch script

**Prerequisites:**
- SSH tunnel to Directus must be active on port 8056:
  ```bash
  ssh -fN -L 8056:172.26.0.2:8055 dedibox1
  ```
  (172.26.0.2 is the halfthemarathon-directus-1 container on the internal network)
- `migrator/.env` must have:
  ```
  DIRECTUS_PUBLIC_URL=http://localhost:8056
  DIRECTUS_TOKEN=2c97978a12a8e4f6970c68c3bc184b52557cab1d30ff5389
  ```

- [ ] **Step 1: Verify tunnel and connectivity**

```bash
curl -s 'http://localhost:8056/server/health' | python3 -m json.tool
```

Expected:
```json
{
    "status": "ok"
}
```

- [ ] **Step 2: Run the patch script**

```bash
cd /home/martin/dev/halfTheMarathon/migrator && npm run patch-polylines
```

Expected output:
```
Reading CSV...
CSV has 784 activities with GPX files
Fetching activities from Directus...
Found ~802 activities to patch
  50 patched, 0 skipped, 0 errors
  100 patched, 0 skipped, 0 errors
  ...
Done. ~784 patched, ~18 skipped (no GPX), 0 errors
```

- [ ] **Step 3: Verify a patched activity in Directus**

```bash
curl -s 'http://localhost:8056/items/activities?filter[summary_polyline][_nnull]=true&aggregate[count]=id' \
  -H 'Authorization: Bearer 2c97978a12a8e4f6970c68c3bc184b52557cab1d30ff5389' | python3 -m json.tool
```

Expected:
```json
{
    "data": [
        {
            "count": {
                "id": "785"
            }
        }
    ]
}
```
(784 Runkeeper + 1 Strava = 785)

- [ ] **Step 4: Spot-check a specific activity's polyline decodes sensibly**

```bash
curl -s 'http://localhost:8056/items/activities?filter[summary_polyline][_nnull]=true&fields=id,name,summary_polyline,start_lat,start_lng&limit=1' \
  -H 'Authorization: Bearer 2c97978a12a8e4f6970c68c3bc184b52557cab1d30ff5389' | python3 -m json.tool
```

Expected: an activity with a non-null `summary_polyline` string (will look like `"_p~iF~ps|U_ulLnnqC_mqNvxq`..."`), `start_lat` around 56-58 (Sweden), `start_lng` around 11-18.

- [ ] **Step 5: Commit final state**

```bash
cd /home/martin/dev/halfTheMarathon
git add -A
git commit -m "feat: backfill GPX polylines for all Runkeeper activities"
```
