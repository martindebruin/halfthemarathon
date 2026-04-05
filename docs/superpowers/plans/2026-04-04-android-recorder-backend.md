# Android Recorder — Backend Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/run` to the webhook-listener service so the Android app can upload recorded runs to Directus.

**Architecture:** One new route file in the existing Express webhook-listener, following the same upsert-on-idempotency-key pattern as `upsertStravaActivity`. Auth via a shared bearer token (`APP_BEARER_TOKEN` env var). Validation logic extracted into a pure exported function so it can be unit-tested without spinning up Express.

**Tech Stack:** TypeScript, Express 4, Vitest, existing `directusFetch` helper in `webhook-listener/src/directus.ts`

---

## File Map

| File | Change |
|---|---|
| `webhook-listener/src/directus.ts` | Add `AppRunPayload` interface + `upsertAppRun` function |
| `webhook-listener/src/routes/run.ts` | New — `runRouter` + exported `validateAppRunPayload` |
| `webhook-listener/src/routes/run.test.ts` | New — unit tests for `validateAppRunPayload` |
| `webhook-listener/src/index.ts` | Register `runRouter` at `/api/run` |
| `.env.example` | Add `APP_BEARER_TOKEN` |

---

## Task 1: Add `upsertAppRun` to `directus.ts`

**Files:**
- Modify: `webhook-listener/src/directus.ts`

- [ ] **Step 1: Add the interface and function**

Append to the bottom of `webhook-listener/src/directus.ts`:

```typescript
export interface AppRunPayload {
  app_run_id: string;
  started_at: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s?: number | null;
  avg_speed_ms?: number | null;
  start_lat?: number | null;
  start_lng?: number | null;
  summary_polyline?: string | null;
  splits?: unknown[];
}

export async function upsertAppRun(payload: AppRunPayload): Promise<string> {
  const idKey = `app:${payload.app_run_id}`;
  const record = {
    runkeeper_id: idKey,
    source: 'app',
    type: 'Run',
    date: payload.started_at,
    distance_m: payload.distance_m,
    moving_time_s: payload.moving_time_s,
    elapsed_time_s: payload.elapsed_time_s ?? null,
    average_speed: payload.avg_speed_ms ?? null,
    start_lat: payload.start_lat ?? null,
    start_lng: payload.start_lng ?? null,
    summary_polyline: payload.summary_polyline ?? null,
    splits_metric: payload.splits ? JSON.stringify(payload.splits) : null,
  };

  const existing = await directusFetch(
    `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(idKey)}&fields=id`
  ) as { data: Array<{ id: string }> };

  if (existing.data.length > 0) {
    const id = existing.data[0].id;
    await directusFetch(`/items/activities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(record),
    });
    return id;
  }

  const created = await directusFetch('/items/activities', {
    method: 'POST',
    body: JSON.stringify(record),
  }) as { data: { id: string } };
  return created.data.id;
}
```

Note: `directusFetch` is already defined in this file (private). `upsertAppRun` follows the exact same pattern as `upsertStravaActivity` above it.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd webhook-listener && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add webhook-listener/src/directus.ts
git commit -m "feat: add upsertAppRun to webhook-listener directus module"
```

---

## Task 2: Create `run.ts` route with tests

**Files:**
- Create: `webhook-listener/src/routes/run.ts`
- Create: `webhook-listener/src/routes/run.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `webhook-listener/src/routes/run.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateAppRunPayload } from './run.js';

const VALID = {
  app_run_id: '550e8400-e29b-41d4-a716-446655440000',
  started_at: '2026-04-04T07:12:00Z',
  distance_m: 8420,
  moving_time_s: 2640,
};

describe('validateAppRunPayload', () => {
  it('accepts a valid minimal payload', () => {
    expect(validateAppRunPayload(VALID)).toMatchObject({ valid: true });
  });

  it('accepts all optional fields', () => {
    const result = validateAppRunPayload({
      ...VALID,
      elapsed_time_s: 2780,
      avg_speed_ms: 3.19,
      start_lat: 59.334,
      start_lng: 18.063,
      summary_polyline: '_p~iF~ps|U',
      splits: [{ split: 1, distance: 1000, moving_time: 318, average_speed: 3.14, elevation_difference: 4 }],
    });
    expect(result).toMatchObject({ valid: true });
  });

  it('rejects null body', () => {
    expect(validateAppRunPayload(null)).toMatchObject({ valid: false });
  });

  it('rejects missing app_run_id', () => {
    const { app_run_id: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing started_at', () => {
    const { started_at: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing distance_m', () => {
    const { distance_m: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects missing moving_time_s', () => {
    const { moving_time_s: _, ...rest } = VALID;
    expect(validateAppRunPayload(rest)).toMatchObject({ valid: false });
  });

  it('rejects string distance_m', () => {
    expect(validateAppRunPayload({ ...VALID, distance_m: '8420' })).toMatchObject({ valid: false });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd webhook-listener && npm test
```

Expected: 8 failures — `validateAppRunPayload` not defined yet.

- [ ] **Step 3: Create the route implementation**

Create `webhook-listener/src/routes/run.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { upsertAppRun } from '../directus.js';
import { log } from '../logger.js';
import type { AppRunPayload } from '../directus.js';

export const runRouter = Router();

export function validateAppRunPayload(
  body: unknown
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

runRouter.post('/', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== process.env.APP_BEARER_TOKEN) {
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
    await upsertAppRun(validation.payload);
    log('info', 'app_run_saved', { app_run_id: validation.payload.app_run_id });
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    log('error', 'app_run_failed', { app_run_id: validation.payload.app_run_id, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd webhook-listener && npm test
```

Expected: all tests pass (8 new + existing passing).

- [ ] **Step 5: Commit**

```bash
git add webhook-listener/src/routes/run.ts webhook-listener/src/routes/run.test.ts
git commit -m "feat: add POST /api/run route to webhook-listener"
```

---

## Task 3: Register route, update env, deploy

**Files:**
- Modify: `webhook-listener/src/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Register the route in `index.ts`**

In `webhook-listener/src/index.ts`, add the import after the existing router import:

```typescript
import { runRouter } from './routes/run.js';
```

Add the route registration after `app.use('/webhook', webhookRouter);`:

```typescript
app.use('/api/run', runRouter);
```

The relevant section of `index.ts` after the change:

```typescript
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRouter);
app.use('/api/run', runRouter);
```

- [ ] **Step 2: Add `APP_BEARER_TOKEN` to `.env.example`**

Append to `.env.example`:

```
APP_BEARER_TOKEN=       # random 32+ char string for Android app authentication
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd webhook-listener && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
cd webhook-listener && npm test
```

Expected: all tests pass.

- [ ] **Step 5: Add token to server .env and deploy**

Generate a random token:
```bash
openssl rand -hex 32
```

Copy the output. SSH to the server and add it to `.env`:
```bash
ssh dedibox1 "echo 'APP_BEARER_TOKEN=<paste-token-here>' >> /home/martin/dockers/halfthemarathon/.env"
```

Sync and rebuild:
```bash
rsync -avz webhook-listener/src/ dedibox1:/home/martin/dockers/halfthemarathon/webhook-listener/src/
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d webhook-listener"
```

- [ ] **Step 6: Smoke-test the endpoint**

From your local machine (replace `<token>` and `<host>`):
```bash
curl -X POST https://<host>/api/run \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"app_run_id":"test-001","started_at":"2026-04-04T07:00:00Z","distance_m":1000,"moving_time_s":300}'
```

Expected response: `{"status":"ok"}`

Retry the same request — should return `{"status":"ok"}` again (idempotent, updates same record).

- [ ] **Step 7: Commit**

```bash
git add webhook-listener/src/index.ts .env.example
git commit -m "feat: register /api/run route and add APP_BEARER_TOKEN to env example"
```
