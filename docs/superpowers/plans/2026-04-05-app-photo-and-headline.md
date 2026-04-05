# App Photo Upload + Dynamic Run Headlines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add photo attachment to app runs and auto-generate Swedish run titles using reverse geocoding and a local LLM.

**Architecture:** Headline generation is fire-and-forget from `POST /api/run` — response returns immediately, LLM call happens after in the background. Photo upload is a new `POST /api/run/:id/photo` endpoint that stores the image in Directus and returns an asset URL. Android gets a tap-to-add-photo flow on synced runs using a dialog with gallery/camera options.

**Tech Stack:** Node.js/TypeScript (webhook-listener), Nominatim OSM (reverse geocoding), Mistral Small 24B on frmwrk-ai at `http://100.98.25.111:8080/v1` via Tailscale, `multer` (multipart), Kotlin/Android + Coil (image loading), OkHttp (multipart upload).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `webhook-listener/src/headline.ts` | Create | All headline logic: time/day labels, geocoding, LLM call, fallback, `generateAndSaveHeadline` |
| `webhook-listener/src/headline.test.ts` | Create | Unit tests for all headline functions |
| `webhook-listener/src/directus.ts` | Modify | Add `patchActivityName`, `uploadPhotoForAppRun` |
| `webhook-listener/src/routes/run.ts` | Modify | Add `POST /:id/photo` route; fire headline after run save |
| `webhook-listener/package.json` | Modify | Add `multer` + `@types/multer` |
| `android/app/src/main/java/com/htmitub/recorder/db/Run.kt` | Modify | Add `photoUrl: String?` field |
| `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt` | Modify | Bump version to 2, add migration |
| `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt` | Modify | Add `updatePhotoUrl` query |
| `android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt` | Modify | Add `uploadPhoto()` |
| `android/app/build.gradle.kts` | Modify | Add Coil dependency |
| `android/app/src/main/AndroidManifest.xml` | Modify | Add CAMERA permission + FileProvider |
| `android/app/src/main/res/xml/file_paths.xml` | Create | FileProvider path config |
| `android/app/src/main/res/layout/item_run.xml` | Modify | Add thumbnail ImageView |
| `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt` | Modify | Tap-to-add-photo flow |

---

## Task 1: Swedish time/day helpers in `headline.ts`

**Files:**
- Create: `webhook-listener/src/headline.ts`
- Create: `webhook-listener/src/headline.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `webhook-listener/src/headline.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTimeOfDayLabel,
  getSwedishDayLabel,
  getPlaceName,
  generateHeadline,
} from './headline.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getTimeOfDayLabel', () => {
  it('returns "på morgonen" at 08:00 Stockholm winter', () => {
    // 08:00 Stockholm UTC+1 = 07:00 UTC
    expect(getTimeOfDayLabel(new Date('2026-01-15T07:00:00Z'))).toBe('på morgonen');
  });
  it('returns "på förmiddagen" at 10:30 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T09:30:00Z'))).toBe('på förmiddagen');
  });
  it('returns "vid lunch" at 12:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T11:00:00Z'))).toBe('vid lunch');
  });
  it('returns "på eftermiddagen" at 15:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T14:00:00Z'))).toBe('på eftermiddagen');
  });
  it('returns "på kvällen" at 19:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T18:00:00Z'))).toBe('på kvällen');
  });
  it('returns "på natten" at 23:00 Stockholm', () => {
    expect(getTimeOfDayLabel(new Date('2026-01-15T22:00:00Z'))).toBe('på natten');
  });
});

describe('getSwedishDayLabel', () => {
  it('returns "Juldagen" on Dec 25', () => {
    expect(getSwedishDayLabel(new Date('2026-12-25T12:00:00Z'))).toBe('Juldagen');
  });
  it('returns "Julafton" on Dec 24', () => {
    expect(getSwedishDayLabel(new Date('2026-12-24T12:00:00Z'))).toBe('Julafton');
  });
  it('returns "Påskdagen" on Easter 2026 (April 5)', () => {
    expect(getSwedishDayLabel(new Date('2026-04-05T12:00:00Z'))).toBe('Påskdagen');
  });
  it('returns "Långfredagen" on Good Friday 2026 (April 3)', () => {
    expect(getSwedishDayLabel(new Date('2026-04-03T12:00:00Z'))).toBe('Långfredagen');
  });
  it('returns "Nationaldagen" on June 6', () => {
    expect(getSwedishDayLabel(new Date('2026-06-06T12:00:00Z'))).toBe('Nationaldagen');
  });
  it('returns "Valborg" on April 30', () => {
    expect(getSwedishDayLabel(new Date('2026-04-30T12:00:00Z'))).toBe('Valborg');
  });
  it('returns "Midsommarafton" on June 19 2026 (Friday)', () => {
    expect(getSwedishDayLabel(new Date('2026-06-19T12:00:00Z'))).toBe('Midsommarafton');
  });
  it('returns "Måndag" on a regular Monday', () => {
    // Jan 12 2026 is a Monday
    expect(getSwedishDayLabel(new Date('2026-01-12T12:00:00Z'))).toBe('Måndag');
  });
  it('returns "Nyårsdagen" on Jan 1', () => {
    expect(getSwedishDayLabel(new Date('2026-01-01T12:00:00Z'))).toBe('Nyårsdagen');
  });
});

describe('getPlaceName', () => {
  it('returns city from Nominatim response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: 'Strängnäs', country: 'Sverige' } }),
    }));
    expect(await getPlaceName(59.37, 17.03)).toBe('Strängnäs');
  });

  it('falls back to town when city absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { town: 'Mariefred' } }),
    }));
    expect(await getPlaceName(59.25, 17.19)).toBe('Mariefred');
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network')));
    expect(await getPlaceName(0, 0)).toBeNull();
  });
});

describe('generateHeadline', () => {
  it('returns LLM response on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Påsklöpning i Strängnäs vid lunch' } }],
      }),
    }));
    expect(await generateHeadline('Strängnäs', 'Påskdagen', 'vid lunch'))
      .toBe('Påsklöpning i Strängnäs vid lunch');
  });

  it('returns fallback with place when LLM fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline('Strängnäs', 'Måndag', 'på morgonen'))
      .toBe('Måndagslöpning i Strängnäs på morgonen');
  });

  it('returns fallback without place when place is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Timeout')));
    expect(await generateHeadline(null, 'Söndag', 'på kvällen'))
      .toBe('Söndagslöpning på kvällen');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd webhook-listener && npm test -- headline
```

Expected: `Cannot find module './headline.js'`

- [ ] **Step 3: Implement `getTimeOfDayLabel`, `getSwedishDayLabel`, `getPlaceName`, `generateHeadline`**

Create `webhook-listener/src/headline.ts`:

```typescript
import { patchActivityName } from './directus.js';

// Local Stockholm time from a UTC Date
function toStockholm(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
}

export function getTimeOfDayLabel(date: Date): string {
  const local = toStockholm(date);
  const min = local.getHours() * 60 + local.getMinutes();
  if (min >= 5 * 60 && min < 10 * 60) return 'på morgonen';
  if (min >= 10 * 60 && min < 11 * 60 + 30) return 'på förmiddagen';
  if (min >= 11 * 60 + 30 && min <= 13 * 60 + 30) return 'vid lunch';
  if (min > 13 * 60 + 30 && min < 17 * 60) return 'på eftermiddagen';
  if (min >= 17 * 60 && min < 21 * 60) return 'på kvällen';
  return 'på natten';
}

// Anonymous Gregorian algorithm — returns UTC midnight of Easter Sunday
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 1-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

export function getSwedishDayLabel(date: Date): string {
  const local = toStockholm(date);
  const year = local.getFullYear();
  const month = local.getMonth() + 1;
  const day = local.getDate();
  const dow = local.getDay(); // 0=Sunday

  // Fixed public holidays
  const fixed: Array<[number, number, string]> = [
    [1, 1, 'Nyårsdagen'],
    [1, 6, 'Trettondedag jul'],
    [4, 30, 'Valborg'],
    [6, 6, 'Nationaldagen'],
    [12, 24, 'Julafton'],
    [12, 25, 'Juldagen'],
    [12, 26, 'Annandag jul'],
    [12, 31, 'Nyårsafton'],
  ];
  for (const [m, d, name] of fixed) {
    if (month === m && day === d) return name;
  }

  // Easter-relative holidays
  const easter = easterSunday(year);
  const easterRelative: Array<[number, string]> = [
    [-2, 'Långfredagen'],
    [-1, 'Påskafton'],
    [0, 'Påskdagen'],
    [1, 'Annandag påsk'],
    [39, 'Kristi himmelsfärdsdag'],
    [49, 'Pingstdagen'],
  ];
  // Use UTC date of the local day for comparison
  const localUtc = new Date(Date.UTC(year, month - 1, day));
  for (const [offset, name] of easterRelative) {
    if (sameDay(localUtc, addDays(easter, offset))) return name;
  }

  // Midsommarafton: Friday Jun 19–25
  if (month === 6 && dow === 5 && day >= 19 && day <= 25) return 'Midsommarafton';
  // Midsommardagen: Saturday Jun 20–26
  if (month === 6 && dow === 6 && day >= 20 && day <= 26) return 'Midsommardagen';
  // Alla helgons dag: Saturday Oct 31 – Nov 6
  if (((month === 10 && day === 31) || (month === 11 && day <= 6)) && dow === 6) return 'Alla helgons dag';

  const WEEKDAYS = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  return WEEKDAYS[dow];
}

export async function getPlaceName(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=sv`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'htmitub-run-recorder/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { address?: Record<string, string> };
    const addr = data.address ?? {};
    return addr.city ?? addr.town ?? addr.village ?? addr.municipality ?? null;
  } catch {
    return null;
  }
}

function buildFallback(place: string | null, day: string, time: string): string {
  const parts = [`${day}slöpning`];
  if (place) parts.push(`i ${place}`);
  parts.push(time);
  return parts.join(' ');
}

export async function generateHeadline(
  place: string | null,
  day: string,
  time: string,
): Promise<string> {
  const fallback = buildFallback(place, day, time);
  try {
    const lines: string[] = [];
    if (place) lines.push(`Plats: ${place}.`);
    lines.push(`Tid: ${time}.`);
    lines.push(`Dag: ${day}.`);
    lines.push('Ge mig en löpartitel.');

    const res = await fetch('http://100.98.25.111:8080/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral-small:24b',
        messages: [
          {
            role: 'system',
            content: 'Du är en assistent som genererar korta, naturliga svenska titlar för löprundor. Svara ENBART med titeln, inget annat. Titeln ska vara 4–7 ord, casual och beskrivande.',
          },
          { role: 'user', content: lines.join(' ') },
        ],
        max_tokens: 30,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || fallback;
  } catch {
    return fallback;
  }
}

export async function generateAndSaveHeadline(
  activityId: string,
  startedAt: string,
  lat: number | null,
  lng: number | null,
): Promise<void> {
  const date = new Date(startedAt);
  const [place, day, time] = await Promise.all([
    lat != null && lng != null ? getPlaceName(lat, lng) : Promise.resolve(null),
    Promise.resolve(getSwedishDayLabel(date)),
    Promise.resolve(getTimeOfDayLabel(date)),
  ]);
  const headline = await generateHeadline(place, day, time);
  await patchActivityName(activityId, headline);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd webhook-listener && npm test -- headline
```

Expected: all 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add webhook-listener/src/headline.ts webhook-listener/src/headline.test.ts
git commit -m "feat: add Swedish headline generator with time/day/LLM/fallback"
```

---

## Task 2: Add `patchActivityName` and `uploadPhotoForAppRun` to `directus.ts`

**Files:**
- Modify: `webhook-listener/src/directus.ts`

- [ ] **Step 1: Append `patchActivityName` to `directus.ts`**

Append to the bottom of `webhook-listener/src/directus.ts`:

```typescript
export async function patchActivityName(id: string, name: string): Promise<void> {
  await directusFetch(`/items/activities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function uploadPhotoForAppRun(
  appRunId: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const idKey = `app:${appRunId}`;

  const existing = await directusFetch(
    `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(idKey)}&fields=id`,
  ) as { data: Array<{ id: string }> };
  if (existing.data.length === 0) return null;
  const activityId = existing.data[0].id;

  const filename = `app-run-${appRunId}.jpg`;
  const form = new globalThis.FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  const fileRes = await fetch(`${getDirectusUrl()}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!fileRes.ok) throw new Error(`File upload failed ${fileRes.status}`);
  const fileData = await fileRes.json() as { data: { id: string } };
  const fileId = fileData.data.id;

  await directusFetch('/items/photos', {
    method: 'POST',
    body: JSON.stringify({
      activity_id: activityId,
      directus_file_id: fileId,
      original_filename: filename,
      caption: null,
      lat: null,
      lng: null,
    }),
  });

  const publicUrl = process.env.DIRECTUS_PUBLIC_URL ?? 'https://cms-run.martindebruin.se';
  return `${publicUrl}/assets/${fileId}?width=240&height=144&fit=cover&quality=70`;
}
```

- [ ] **Step 2: Type-check**

```bash
cd webhook-listener && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add webhook-listener/src/directus.ts
git commit -m "feat: add patchActivityName and uploadPhotoForAppRun to directus module"
```

---

## Task 3: Wire headline into `POST /api/run` and add photo route

**Files:**
- Modify: `webhook-listener/package.json`
- Modify: `webhook-listener/src/routes/run.ts`

- [ ] **Step 1: Add multer to package.json**

In `webhook-listener/package.json`, add to `"dependencies"`:
```json
"multer": "^1.4.5-lts.1"
```
And to `"devDependencies"`:
```json
"@types/multer": "^1.4.12"
```

Then:
```bash
cd webhook-listener && npm install
```

- [ ] **Step 2: Replace `webhook-listener/src/routes/run.ts` with the full updated version**

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { upsertAppRun, uploadPhotoForAppRun } from '../directus.js';
import { generateAndSaveHeadline } from '../headline.js';
import { log } from '../logger.js';
import type { AppRunPayload } from '../directus.js';

export const runRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function validateAppRunPayload(
  body: unknown,
): { valid: true; payload: AppRunPayload } | { valid: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  if (!b.app_run_id || typeof b.app_run_id !== 'string') {
    return { valid: false, error: 'Missing required field: app_run_id' };
  }
  if (!b.started_at || typeof b.started_at !== 'string') {
    return { valid: false, error: 'Missing required field: started_at' };
  }
  if (typeof b.distance_m !== 'number') {
    return { valid: false, error: 'Missing required field: distance_m (must be number)' };
  }
  if (typeof b.moving_time_s !== 'number') {
    return { valid: false, error: 'Missing required field: moving_time_s (must be number)' };
  }
  return { valid: true, payload: b as unknown as AppRunPayload };
}

function checkAuth(req: Request): boolean {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return !!(token && token === process.env.APP_BEARER_TOKEN);
}

runRouter.post('/', async (req: Request, res: Response) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const validation = validateAppRunPayload(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

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
  } catch (err) {
    log('error', 'app_run_failed', { app_run_id: validation.payload.app_run_id, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

runRouter.post('/:id/photo', upload.single('photo'), async (req: Request, res: Response) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No photo attached' });
    return;
  }
  const appRunId = req.params.id;
  try {
    log('info', 'app_photo_received', { app_run_id: appRunId });
    const assetUrl = await uploadPhotoForAppRun(appRunId, req.file.buffer, req.file.mimetype);
    if (assetUrl === null) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    log('info', 'app_photo_saved', { app_run_id: appRunId });
    res.status(200).json({ asset_url: assetUrl });
  } catch (err) {
    log('error', 'app_photo_failed', { app_run_id: appRunId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 3: Type-check**

```bash
cd webhook-listener && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd webhook-listener && npm test
```

Expected: all tests pass (existing + new headline tests).

- [ ] **Step 5: Deploy to dedibox1**

```bash
cd /home/martin/dev/halfTheMarathon
rsync -avz webhook-listener/src/ dedibox1:/home/martin/dockers/halfthemarathon/webhook-listener/src/
rsync webhook-listener/package.json dedibox1:/home/martin/dockers/halfthemarathon/webhook-listener/package.json
rsync webhook-listener/package-lock.json dedibox1:/home/martin/dockers/halfthemarathon/webhook-listener/package-lock.json
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d webhook-listener"
```

- [ ] **Step 6: Smoke test headline**

Upload a test run using the existing `test-smoke-001` payload (or manually via curl):

```bash
ssh dedibox1 "docker logs halfthemarathon-webhook-listener-1 --tail=20"
```

Expected: see `app_run_saved` followed shortly by `headline_failed` (if frmwrk-ai unreachable from dedibox1) or no error (if reachable). Either way the run is saved.

- [ ] **Step 7: Commit**

```bash
git add webhook-listener/src/routes/run.ts webhook-listener/package.json webhook-listener/package-lock.json
git commit -m "feat: fire headline generation after run upload, add photo upload endpoint"
```

---

## Task 4: Android — Room migration (add `photoUrl`)

**Files:**
- Modify: `android/app/src/main/java/com/htmitub/recorder/db/Run.kt`
- Modify: `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt`
- Modify: `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt`

- [ ] **Step 1: Add `photoUrl` to Run entity**

Replace `android/app/src/main/java/com/htmitub/recorder/db/Run.kt`:

```kotlin
package com.htmitub.recorder.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "runs")
data class Run(
    @PrimaryKey val id: String,
    val startedAt: Long,
    val distanceM: Double,
    val movingTimeS: Int,
    val elapsedTimeS: Int,
    val avgSpeedMs: Double,
    val startLat: Double,
    val startLng: Double,
    val summaryPolyline: String,
    val splitsJson: String,
    val syncStatus: String,
    val photoUrl: String? = null,
)
```

- [ ] **Step 2: Add migration and bump DB version**

Replace `android/app/src/main/java/com/htmitub/recorder/db/RunDatabase.kt`:

```kotlin
package com.htmitub.recorder.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

private val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE runs ADD COLUMN photoUrl TEXT")
    }
}

@Database(entities = [Run::class, TrackPoint::class], version = 2, exportSchema = false)
abstract class RunDatabase : RoomDatabase() {
    abstract fun runDao(): RunDao

    companion object {
        @Volatile private var INSTANCE: RunDatabase? = null

        fun getInstance(context: Context): RunDatabase =
            INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    RunDatabase::class.java,
                    "runs.db",
                ).addMigrations(MIGRATION_1_2).build().also { INSTANCE = it }
            }
    }
}
```

- [ ] **Step 3: Add `updatePhotoUrl` to RunDao**

Add to `android/app/src/main/java/com/htmitub/recorder/db/RunDao.kt` (after `markFailed`):

```kotlin
    @Query("UPDATE runs SET photoUrl = :url WHERE id = :id")
    suspend fun updatePhotoUrl(id: String, url: String)
```

- [ ] **Step 4: Run existing unit tests to verify migration doesn't break them**

```bash
cd /home/martin/dev/halfTheMarathon/android && ./gradlew :app:testDebugUnitTest 2>&1 | tail -20
```

Expected: all 12 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/martin/dev/halfTheMarathon/android
git add app/src/main/java/com/htmitub/recorder/db/
git commit -m "feat: add photoUrl field to Run entity with Room migration 1→2"
```

---

## Task 5: Android — `ApiClient.uploadPhoto()` + Coil dependency

**Files:**
- Modify: `android/app/build.gradle.kts`
- Modify: `android/app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt`

- [ ] **Step 1: Add Coil to build.gradle.kts**

In `android/app/build.gradle.kts`, add inside `dependencies { }` (after the OkHttp line):

```kotlin
    implementation("io.coil-kt:coil:2.6.0")
```

- [ ] **Step 2: Add `uploadPhoto` to ApiClient.kt**

Add after the closing brace of `uploadRun`, inside the `ApiClient` class (before the final `}`):

```kotlin
    suspend fun uploadPhoto(appRunId: String, imageBytes: ByteArray): String = withContext(Dispatchers.IO) {
        val mediaType = "image/jpeg".toMediaType()
        val requestBody = okhttp3.MultipartBody.Builder()
            .setType(okhttp3.MultipartBody.FORM)
            .addFormDataPart("photo", "photo.jpg", imageBytes.toRequestBody(mediaType))
            .build()
        val request = Request.Builder()
            .url("${BuildConfig.SERVER_URL}/api/run/$appRunId/photo")
            .addHeader("Authorization", "Bearer ${BuildConfig.BEARER_TOKEN}")
            .post(requestBody)
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Upload failed: HTTP ${response.code}")
            val body = response.body?.string() ?: throw IOException("Empty response")
            // Parse {"asset_url":"..."}
            val assetUrl = body.substringAfter("\"asset_url\":\"").substringBefore("\"")
            if (assetUrl.isBlank()) throw IOException("No asset_url in response")
            assetUrl
        }
    }
```

- [ ] **Step 3: Build to verify compilation**

```bash
cd /home/martin/dev/halfTheMarathon/android && ./gradlew :app:compileDebugKotlin 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
cd /home/martin/dev/halfTheMarathon/android
git add app/build.gradle.kts app/src/main/java/com/htmitub/recorder/sync/ApiClient.kt
git commit -m "feat: add uploadPhoto to ApiClient and Coil dependency"
```

---

## Task 6: Android — Photo picker UI

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/xml/file_paths.xml`
- Modify: `android/app/src/main/res/layout/item_run.xml`
- Modify: `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt`

- [ ] **Step 1: Add CAMERA permission and FileProvider to AndroidManifest.xml**

Replace `android/app/src/main/AndroidManifest.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.CAMERA" />

    <application
        android:name=".App"
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name=".RecordingActivity"
            android:exported="false"
            android:screenOrientation="portrait" />

        <service
            android:name=".RecordingService"
            android:exported="false"
            android:foregroundServiceType="location" />

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>

    </application>
</manifest>
```

- [ ] **Step 2: Create `file_paths.xml`**

Create `android/app/src/main/res/xml/file_paths.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="tmp_photos" path="." />
</paths>
```

- [ ] **Step 3: Add thumbnail ImageView to `item_run.xml`**

Replace `android/app/src/main/res/layout/item_run.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:padding="16dp"
    android:background="@color/bg">

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical">
        <TextView
            android:id="@+id/tvDate"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textColor="@color/text"
            android:textSize="15sp" />
        <TextView
            android:id="@+id/tvStats"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:textColor="@color/muted"
            android:textSize="13sp" />
    </LinearLayout>

    <ImageView
        android:id="@+id/ivPhoto"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:layout_gravity="center_vertical"
        android:layout_marginEnd="8dp"
        android:scaleType="centerCrop"
        android:visibility="gone" />

    <TextView
        android:id="@+id/tvSyncStatus"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_gravity="center_vertical"
        android:layout_marginEnd="8dp"
        android:textSize="11sp" />

    <com.google.android.material.button.MaterialButton
        android:id="@+id/btnUpload"
        android:layout_width="wrap_content"
        android:layout_height="36dp"
        android:text="UPLOAD"
        android:backgroundTint="@color/surface"
        android:textColor="@color/muted"
        android:textSize="11sp"
        android:visibility="gone" />
</LinearLayout>
```

- [ ] **Step 4: Replace `MainActivity.kt` with the full updated version**

Replace `android/app/src/main/java/com/htmitub/recorder/MainActivity.kt`:

```kotlin
package com.htmitub.recorder

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.DividerItemDecoration
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.htmitub.recorder.databinding.ActivityMainBinding
import com.htmitub.recorder.db.Run
import com.htmitub.recorder.db.RunDatabase
import com.htmitub.recorder.sync.ApiClient
import com.htmitub.recorder.sync.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: RunAdapter
    private lateinit var galleryLauncher: ActivityResultLauncher<String>
    private lateinit var cameraLauncher: ActivityResultLauncher<Uri>
    private var cameraUri: Uri? = null
    private var selectedRun: Run? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        galleryLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
            uri ?: return@registerForActivityResult
            handlePhotoSelected(uri)
        }
        cameraLauncher = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
            if (success) cameraUri?.let { handlePhotoSelected(it) }
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = RunAdapter(
            onUploadClick = { SyncWorker.enqueue(this@MainActivity) },
            onRunClick = { run -> showPhotoDialog(run) },
        )

        binding.rvRuns.layoutManager = LinearLayoutManager(this)
        binding.rvRuns.addItemDecoration(DividerItemDecoration(this, DividerItemDecoration.VERTICAL))
        binding.rvRuns.adapter = adapter

        binding.btnStartRun.setOnClickListener {
            startActivity(Intent(this, RecordingActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        loadRuns()
        SyncWorker.enqueue(this)
    }

    private fun loadRuns() {
        lifecycleScope.launch {
            val runs = RunDatabase.getInstance(this@MainActivity).runDao().getAllRuns()
            adapter.submitList(runs)
        }
    }

    private fun showPhotoDialog(run: Run) {
        selectedRun = run
        MaterialAlertDialogBuilder(this)
            .setTitle("Lägg till foto")
            .setItems(arrayOf("Välj från galleri", "Ta foto")) { _, which ->
                when (which) {
                    0 -> galleryLauncher.launch("image/*")
                    1 -> {
                        val tmpFile = File.createTempFile("photo_", ".jpg", cacheDir)
                        cameraUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", tmpFile)
                        cameraLauncher.launch(cameraUri!!)
                    }
                }
            }
            .show()
    }

    private fun handlePhotoSelected(uri: Uri) {
        val run = selectedRun ?: return
        lifecycleScope.launch {
            try {
                val imageBytes = withContext(Dispatchers.IO) { compressImage(uri) }
                val assetUrl = ApiClient().uploadPhoto(run.id, imageBytes)
                RunDatabase.getInstance(this@MainActivity).runDao().updatePhotoUrl(run.id, assetUrl)
                loadRuns()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Foto kunde inte laddas upp", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun compressImage(uri: Uri): ByteArray {
        val inputStream = contentResolver.openInputStream(uri)!!
        val original = BitmapFactory.decodeStream(inputStream)
        inputStream.close()
        val maxDim = 1200
        val scale = maxDim.toFloat() / maxOf(original.width, original.height)
        val bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(
                original,
                (original.width * scale).toInt(),
                (original.height * scale).toInt(),
                true,
            )
        } else {
            original
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
        if (bitmap !== original) bitmap.recycle()
        original.recycle()
        return out.toByteArray()
    }
}

class RunAdapter(
    private val onUploadClick: () -> Unit,
    private val onRunClick: (Run) -> Unit,
) : RecyclerView.Adapter<RunAdapter.ViewHolder>() {

    private var runs: List<Run> = emptyList()

    fun submitList(list: List<Run>) {
        runs = list
        notifyDataSetChanged()
    }

    inner class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvDate: TextView = view.findViewById(R.id.tvDate)
        val tvStats: TextView = view.findViewById(R.id.tvStats)
        val tvSyncStatus: TextView = view.findViewById(R.id.tvSyncStatus)
        val btnUpload: MaterialButton = view.findViewById(R.id.btnUpload)
        val ivPhoto: ImageView = view.findViewById(R.id.ivPhoto)

        init {
            btnUpload.setOnClickListener { onUploadClick() }
            itemView.setOnClickListener {
                val run = runs.getOrNull(bindingAdapterPosition) ?: return@setOnClickListener
                if (run.syncStatus == "synced") onRunClick(run)
            }
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = android.view.LayoutInflater.from(parent.context).inflate(R.layout.item_run, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val run = runs[position]
        holder.tvDate.text = DATE_FMT.format(Date(run.startedAt))

        val distKm = "%.2f km".format(run.distanceM / 1000)
        val avgPace = if (run.avgSpeedMs > 0) {
            val secKm = (1000.0 / run.avgSpeedMs).toInt()
            "%d:%02d /km".format(secKm / 60, secKm % 60)
        } else "—"
        holder.tvStats.text = "$distKm · $avgPace"

        if (run.photoUrl != null) {
            holder.ivPhoto.visibility = View.VISIBLE
            holder.ivPhoto.load(run.photoUrl)
        } else {
            holder.ivPhoto.visibility = View.GONE
        }

        when (run.syncStatus) {
            "synced" -> {
                holder.tvSyncStatus.text = "✓"
                holder.tvSyncStatus.setTextColor(0xFF22C55E.toInt())
                holder.btnUpload.visibility = View.GONE
            }
            "failed" -> {
                holder.tvSyncStatus.text = "!"
                holder.tvSyncStatus.setTextColor(0xFFC0392B.toInt())
                holder.btnUpload.visibility = View.VISIBLE
            }
            else -> {
                holder.tvSyncStatus.text = "…"
                holder.tvSyncStatus.setTextColor(0xFF888888.toInt())
                holder.btnUpload.visibility = View.GONE
            }
        }
    }

    override fun getItemCount() = runs.size

    companion object {
        private val DATE_FMT = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())
    }
}
```

- [ ] **Step 5: Build and install**

```bash
cd /home/martin/dev/halfTheMarathon/android && ./gradlew :app:installDebug 2>&1 | tail -8
```

Expected: `BUILD SUCCESSFUL`, installed on device.

- [ ] **Step 6: Manual test**

1. Open app — home screen shows runs
2. Tap a synced run (✓) — dialog appears with "Välj från galleri" / "Ta foto"
3. Pick a photo from gallery
4. Row shows thumbnail after upload
5. Check `docker logs halfthemarathon-webhook-listener-1 --tail=5` — see `app_photo_saved`

- [ ] **Step 7: Commit**

```bash
cd /home/martin/dev/halfTheMarathon/android
git add app/src/main/AndroidManifest.xml \
        app/src/main/res/xml/file_paths.xml \
        app/src/main/res/layout/item_run.xml \
        app/src/main/java/com/htmitub/recorder/MainActivity.kt
git commit -m "feat: add photo picker and upload UI to run list"
```

---

## Task 7: Push Android repo + commit main repo

- [ ] **Step 1: Push Android changes**

```bash
cd /home/martin/dev/halfTheMarathon/android && git push origin master
```

- [ ] **Step 2: Commit and push main repo**

```bash
cd /home/martin/dev/halfTheMarathon
git add webhook-listener/ docs/
git commit -m "feat: app photo upload and dynamic Swedish run headlines"
git push origin master
```
