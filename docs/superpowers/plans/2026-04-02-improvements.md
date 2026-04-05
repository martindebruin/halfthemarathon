# halfTheMarathon Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the webhook-listener with retry/alerting, backfill Directus from local CSV data, then switch the frontend to live SSR and add maps, filters, calendar, year-in-review, rich stats, and photo features.

**Architecture:** Phase 1 targets the migrator and webhook-listener services independently of the frontend. Phase 2 migrates the frontend from adapter-static (nginx) to adapter-node (live SvelteKit server) so new runs appear immediately, then builds all new routes and components on top.

**Tech Stack:** Node.js 20, TypeScript, SvelteKit 2 / Svelte 5 runes, Directus SDK, better-sqlite3 (queue), Leaflet + OSM (maps), Chart.js (stats charts), Telegram Bot API (alerting), vitest (tests).

**Test setup note:** None of the packages currently have a test runner. Each phase-1 task adds vitest to its package before writing tests.

---

## Phase 1 — Stability

---

### Task 1: Backfill Script

**Files:**
- Create: `migrator/src/backfill.ts`
- Modify: `migrator/package.json`

- [ ] **Step 1: Add vitest to migrator**

```bash
cd migrator && npm install --save-dev vitest
```

Add to `migrator/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 2: Write failing test for activity-to-CSV matching**

Create `migrator/src/backfill.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { RunkeeperActivity } from './types.js';

// Pure function extracted from backfill — matches photo records to activities by activityId
function groupPhotosByActivity(photos: Array<{ activityId: string; imageFileName: string }>) {
  const map = new Map<string, typeof photos>();
  for (const p of photos) {
    if (!map.has(p.activityId)) map.set(p.activityId, []);
    map.get(p.activityId)!.push(p);
  }
  return map;
}

describe('groupPhotosByActivity', () => {
  it('groups photos by activityId', () => {
    const photos = [
      { activityId: 'act1', imageFileName: 'a.jpg' },
      { activityId: 'act1', imageFileName: 'b.jpg' },
      { activityId: 'act2', imageFileName: 'c.jpg' },
    ];
    const result = groupPhotosByActivity(photos);
    expect(result.get('act1')).toHaveLength(2);
    expect(result.get('act2')).toHaveLength(1);
    expect(result.get('act3')).toBeUndefined();
  });

  it('returns empty map for empty input', () => {
    expect(groupPhotosByActivity([])).toEqual(new Map());
  });
});
```

- [ ] **Step 3: Run test — confirm it fails**

```bash
cd migrator && npm test -- backfill.test.ts
```
Expected: `groupPhotosByActivity is not defined`

- [ ] **Step 4: Create `migrator/src/backfill.ts`**

```typescript
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PhotoRecord } from './types.js';
import { parseCardioActivities, parsePhotos } from './parse.js';
import { upsertActivity, upsertPhoto } from './directus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(ROOT, 'recovered');

export function groupPhotosByActivity(
  photos: PhotoRecord[]
): Map<string, PhotoRecord[]> {
  const map = new Map<string, PhotoRecord[]>();
  for (const p of photos) {
    if (!map.has(p.activityId)) map.set(p.activityId, []);
    map.get(p.activityId)!.push(p);
  }
  return map;
}

async function main() {
  const csvPath = path.join(RECOVERED_DIR, 'cardioActivities.csv');
  const photosPath = path.join(RECOVERED_DIR, 'photos.csv');

  console.log('Parsing activities...');
  const activities = parseCardioActivities(csvPath);
  const photos = parsePhotos(photosPath);
  const photosByActivity = groupPhotosByActivity(photos);

  console.log(`Upserting ${activities.length} activities...`);
  let done = 0;
  let errors = 0;

  for (const activity of activities) {
    try {
      const directusId = await upsertActivity(activity, null);
      const actPhotos = photosByActivity.get(activity.activityId) ?? [];
      for (const photo of actPhotos) {
        try {
          await upsertPhoto(directusId, photo, RECOVERED_DIR);
        } catch (err) {
          console.error(`Photo upload failed for ${photo.imageFileName}:`, err);
        }
      }
      done++;
      if (done % 50 === 0) process.stdout.write(`  ${done}/${activities.length}\n`);
    } catch (err) {
      errors++;
      console.error(`Failed to upsert activity ${activity.activityId}:`, err);
    }
  }

  console.log(`Done. ${done} upserted, ${errors} errors.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 5: Update test import and run**

Update `migrator/src/backfill.test.ts` — replace the inline function with the import:
```typescript
import { describe, it, expect } from 'vitest';
import { groupPhotosByActivity } from './backfill.js';
```
Remove the inline `groupPhotosByActivity` function definition from the test file.

```bash
cd migrator && npm test -- backfill.test.ts
```
Expected: PASS

- [ ] **Step 6: Add script to package.json**

Add to `migrator/package.json` scripts:
```json
"backfill": "tsx src/backfill.ts"
```

- [ ] **Step 7: Smoke-test against Directus (requires running stack)**

```bash
cd migrator && npm run backfill
```
Expected: `Done. 802 upserted, 0 errors.` (or near-zero errors for missing photo files)

- [ ] **Step 8: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add migrator/src/backfill.ts migrator/src/backfill.test.ts migrator/package.json
git commit -m "feat(migrator): add backfill script — local CSV → Directus, no Strava API calls"
```

---

### Task 2: Structured Logging (webhook-listener)

**Files:**
- Create: `webhook-listener/src/logger.ts`
- Create: `webhook-listener/src/logger.test.ts`
- Modify: `webhook-listener/src/index.ts`
- Modify: `webhook-listener/src/routes/webhook.ts`
- Modify: `webhook-listener/package.json`

- [ ] **Step 1: Add vitest to webhook-listener**

```bash
cd webhook-listener && npm install --save-dev vitest
```

Add to `webhook-listener/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 2: Write failing test for logger**

Create `webhook-listener/src/logger.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

describe('log', () => {
  it('writes a JSON line to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // import after spy is set
    vi.resetModules();

    const { log } = await import('./logger.js');
    log('info', 'test_event', { activity_id: 42 });

    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('test_event');
    expect(parsed.activity_id).toBe(42);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    writeSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

```bash
cd webhook-listener && npm test -- logger.test.ts
```
Expected: `Cannot find module './logger.js'`

- [ ] **Step 4: Create `webhook-listener/src/logger.ts`**

```typescript
type Level = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: Level;
  event: string;
  activity_id?: number;
  error?: string;
  [key: string]: unknown;
}

export function log(level: Level, event: string, extra?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'event'>>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...extra,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}
```

- [ ] **Step 5: Run — confirm it passes**

```bash
cd webhook-listener && npm test -- logger.test.ts
```
Expected: PASS

- [ ] **Step 6: Replace console.log in `webhook-listener/src/index.ts`**

Replace the file contents with:
```typescript
import 'dotenv/config';
import express from 'express';
import { webhookRouter } from './routes/webhook.js';
import { log } from './logger.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  log('info', 'server_started', { port: PORT });
});
```

- [ ] **Step 7: Replace console calls in `webhook-listener/src/routes/webhook.ts`**

Add `import { log } from '../logger.js';` at the top.

Replace every `console.log(...)` and `console.error(...)` call:
- `console.log('Received webhook event', ...)` → `log('info', 'webhook_received', { activity_id: event.object_id })`
- `console.log('Syncing activity', id)` → `log('info', 'activity_sync_start', { activity_id: id })`
- `console.log('Activity synced', id)` → `log('info', 'activity_sync_done', { activity_id: id })`
- `console.error('Error processing webhook', err)` → `log('error', 'webhook_processing_failed', { error: String(err) })`

Read the current file first and replace each console call individually. Preserve all existing logic.

- [ ] **Step 8: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add webhook-listener/src/logger.ts webhook-listener/src/logger.test.ts \
  webhook-listener/src/index.ts webhook-listener/src/routes/webhook.ts \
  webhook-listener/package.json
git commit -m "feat(webhook): structured JSON logging via logger.ts"
```

---

### Task 3: Webhook Retry Queue

**Files:**
- Create: `webhook-listener/src/queue.ts`
- Create: `webhook-listener/src/queue.test.ts`
- Modify: `webhook-listener/src/routes/webhook.ts`
- Modify: `webhook-listener/src/index.ts`
- Modify: `webhook-listener/package.json`
- Modify: `webhook-listener/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.gitignore`

- [ ] **Step 1: Install better-sqlite3**

```bash
cd webhook-listener && npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Write failing tests for queue**

Create `webhook-listener/src/queue.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createQueue, type EventQueue } from './queue.js';

describe('EventQueue', () => {
  let db: InstanceType<typeof Database>;
  let queue: EventQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    queue = createQueue(db);
  });

  afterEach(() => db.close());

  it('enqueues an event and returns an id', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 1, aspect_type: 'create', owner_id: 99 });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('picks up pending events', () => {
    queue.enqueue({ object_type: 'activity', object_id: 1, aspect_type: 'create', owner_id: 99 });
    const pending = queue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('marks event as done', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 2, aspect_type: 'update', owner_id: 99 });
    queue.markDone(id);
    expect(queue.getPending()).toHaveLength(0);
  });

  it('increments attempt count and marks failed', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 3, aspect_type: 'create', owner_id: 99 });
    queue.markFailed(id, 'timeout');
    const row = queue.getById(id);
    expect(row?.attempts).toBe(1);
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('timeout');
  });

  it('does not return failed events with attempts >= 3', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 4, aspect_type: 'create', owner_id: 99 });
    queue.markFailed(id, 'err');
    queue.markFailed(id, 'err');
    queue.markFailed(id, 'err');
    expect(queue.getPending()).toHaveLength(0);
  });

  it('returns failed events ready for retry after backoff', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 5, aspect_type: 'create', owner_id: 99 });
    // Force updated_at into the past
    db.prepare("UPDATE pending_events SET updated_at = datetime('now', '-120 seconds'), attempts = 1, status = 'failed' WHERE id = ?").run(id);
    const pending = queue.getPending();
    expect(pending.some((r) => r.id === id)).toBe(true);
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

```bash
cd webhook-listener && npm test -- queue.test.ts
```
Expected: `Cannot find module './queue.js'`

- [ ] **Step 4: Create `webhook-listener/src/queue.ts`**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface StravaEvent {
  object_type: string;
  object_id: number;
  aspect_type: string;
  owner_id: number;
  [key: string]: unknown;
}

interface QueueRow {
  id: number;
  strava_event: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventQueue {
  enqueue(event: StravaEvent): number;
  getPending(): QueueRow[];
  getById(id: number): QueueRow | undefined;
  markDone(id: number): void;
  markFailed(id: number, error: string): void;
}

// Backoff thresholds in seconds per attempt number
const BACKOFF_SECONDS: Record<number, number> = { 1: 0, 2: 60, 3: 300 };

export function createQueue(db: InstanceType<typeof Database>): EventQueue {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_event TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return {
    enqueue(event) {
      const result = db
        .prepare(`INSERT INTO pending_events (strava_event) VALUES (?)`)
        .run(JSON.stringify(event));
      return result.lastInsertRowid as number;
    },

    getPending() {
      return db.prepare(`
        SELECT * FROM pending_events
        WHERE status = 'pending'
           OR (status = 'failed' AND attempts < 3 AND (
             (attempts = 1 AND updated_at <= datetime('now', '-${BACKOFF_SECONDS[2]} seconds'))
          OR (attempts = 2 AND updated_at <= datetime('now', '-${BACKOFF_SECONDS[3]} seconds'))
          OR  attempts = 0
         ))
        ORDER BY created_at ASC
      `).all() as QueueRow[];
    },

    getById(id) {
      return db.prepare(`SELECT * FROM pending_events WHERE id = ?`).get(id) as QueueRow | undefined;
    },

    markDone(id) {
      db.prepare(`UPDATE pending_events SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(id);
    },

    markFailed(id, error) {
      db.prepare(`
        UPDATE pending_events
        SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(error, id);
    },
  };
}

export function openQueue(): InstanceType<typeof Database> & { queue: EventQueue } {
  const dbPath = process.env.QUEUE_DB_PATH ?? path.join(process.cwd(), 'data/queue.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath) as InstanceType<typeof Database> & { queue: EventQueue };
  db.queue = createQueue(db);
  return db;
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd webhook-listener && npm test -- queue.test.ts
```
Expected: all 6 tests PASS

- [ ] **Step 6: Update `webhook-listener/src/routes/webhook.ts` to use the queue**

Replace the file with the following (preserves all existing logic, adds queue):
```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { fetchActivity } from '../strava.js';
import { upsertStravaActivity } from '../directus.js';
import { log } from '../logger.js';
import type { StravaEvent, EventQueue } from '../queue.js';

export const webhookRouter = Router();

// Injected at startup
let _queue: EventQueue;
export function setQueue(q: EventQueue) { _queue = q; }

webhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    log('info', 'webhook_verified');
    res.json({ 'hub.challenge': challenge });
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

webhookRouter.post('/', (req: Request, res: Response) => {
  const event = req.body as StravaEvent;
  log('info', 'webhook_received', { activity_id: event.object_id });

  const id = _queue.enqueue(event);
  log('info', 'webhook_queued', { queue_id: id, activity_id: event.object_id });

  res.status(200).json({ status: 'queued' });
});

export async function processEvent(event: StravaEvent): Promise<void> {
  if (event.object_type !== 'activity') return;
  if (event.aspect_type !== 'create' && event.aspect_type !== 'update') return;

  log('info', 'activity_sync_start', { activity_id: event.object_id });
  const activity = await fetchActivity(event.object_id);
  await upsertStravaActivity(activity as Record<string, unknown>);
  log('info', 'activity_sync_done', { activity_id: event.object_id });
}
```

- [ ] **Step 7: Update `webhook-listener/src/index.ts` to start the background worker**

```typescript
import 'dotenv/config';
import express from 'express';
import { webhookRouter, setQueue, processEvent } from './routes/webhook.js';
import { log } from './logger.js';
import { openQueue } from './queue.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

const db = openQueue();
setQueue(db.queue);

// Background worker
setInterval(async () => {
  const pending = db.queue.getPending();
  for (const row of pending) {
    try {
      const event = JSON.parse(row.strava_event);
      await processEvent(event);
      db.queue.markDone(row.id);
    } catch (err) {
      db.queue.markFailed(row.id, String(err));
      log('warn', 'queue_event_failed', { queue_id: row.id, attempts: row.attempts + 1, error: String(err) });
    }
  }
}, 10_000);

app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  log('info', 'server_started', { port: PORT });
});
```

- [ ] **Step 8: Update `webhook-listener/Dockerfile` for native module build**

Replace file contents:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p data && chown app:app data
USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/index.js"]
```

- [ ] **Step 9: Mount queue data in `docker-compose.yml`**

Under the `webhook-listener` service, add a `volumes` key:
```yaml
    volumes:
      - webhook_data:/app/data
```

And under the top-level `volumes:` block, add:
```yaml
  webhook_data:
```

- [ ] **Step 10: Add data directory to .gitignore**

Add to `.gitignore`:
```
webhook-listener/data/
```

- [ ] **Step 11: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add webhook-listener/src/queue.ts webhook-listener/src/queue.test.ts \
  webhook-listener/src/routes/webhook.ts webhook-listener/src/index.ts \
  webhook-listener/package.json webhook-listener/package-lock.json \
  webhook-listener/Dockerfile docker-compose.yml .gitignore
git commit -m "feat(webhook): SQLite retry queue — persist events before processing, retry up to 3× with backoff"
```

---

### Task 4: Telegram Alerting

**Files:**
- Create: `webhook-listener/src/notify.ts`
- Create: `webhook-listener/src/notify.test.ts`
- Modify: `webhook-listener/src/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing test for notify**

Create `webhook-listener/src/notify.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildMessage } from './notify.js';

describe('buildMessage', () => {
  it('includes event type and timestamp', () => {
    const msg = buildMessage('queue_exhausted', { activity_id: 123, error: 'timeout' });
    expect(msg).toContain('queue_exhausted');
    expect(msg).toContain('123');
    expect(msg).toContain('timeout');
  });

  it('handles missing optional fields', () => {
    const msg = buildMessage('directus_unreachable', {});
    expect(msg).toContain('directus_unreachable');
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

```bash
cd webhook-listener && npm test -- notify.test.ts
```
Expected: `Cannot find module './notify.js'`

- [ ] **Step 3: Create `webhook-listener/src/notify.ts`**

```typescript
import { log } from './logger.js';

export function buildMessage(event: string, ctx: { activity_id?: number; error?: string; [key: string]: unknown }): string {
  const lines = [`⚠️ htmitub webhook-listener: ${event}`];
  if (ctx.activity_id != null) lines.push(`Activity ID: ${ctx.activity_id}`);
  if (ctx.error) lines.push(`Error: ${ctx.error}`);
  lines.push(`Time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

export async function notify(event: string, ctx: { activity_id?: number; error?: string; [key: string]: unknown } = {}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('warn', 'telegram_not_configured');
    return;
  }
  const text = buildMessage(event, ctx);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) log('warn', 'telegram_send_failed', { status: res.status });
  } catch (err) {
    log('error', 'telegram_send_error', { error: String(err) });
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd webhook-listener && npm test -- notify.test.ts
```
Expected: PASS

- [ ] **Step 5: Wire alerting into `webhook-listener/src/index.ts`**

Add `import { notify } from './notify.js';` at the top.

In the background worker interval, after `markFailed`, add exhaustion check:
```typescript
      const updated = db.queue.getById(row.id);
      if (updated && updated.attempts >= 3) {
        await notify('queue_exhausted', { activity_id: JSON.parse(row.strava_event).object_id, error: String(err) });
      }
```

Add after `app.listen(...)`:
```typescript
process.on('uncaughtException', async (err) => {
  log('error', 'uncaught_exception', { error: String(err) });
  await notify('uncaught_exception', { error: String(err) });
  process.exit(1);
});
```

Add a startup Directus reachability check before `app.listen`:
```typescript
async function checkDirectus(): Promise<void> {
  const url = (process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055') + '/server/health';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('info', 'directus_reachable');
  } catch (err) {
    log('error', 'directus_unreachable', { error: String(err) });
    await notify('directus_unreachable', { error: String(err) });
  }
}

await checkDirectus();
```

Mark `index.ts` top-level as async by wrapping in an IIFE:
```typescript
(async () => {
  await checkDirectus();
  app.listen(PORT, () => { log('info', 'server_started', { port: PORT }); });
  process.on('uncaughtException', async (err) => { ... });
})();
```

- [ ] **Step 6: Update `.env.example`**

Add to `.env.example`:
```
TELEGRAM_BOT_TOKEN=   # Telegram bot token
TELEGRAM_CHAT_ID=     # Your Telegram chat ID
```

- [ ] **Step 7: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add webhook-listener/src/notify.ts webhook-listener/src/notify.test.ts \
  webhook-listener/src/index.ts .env.example
git commit -m "feat(webhook): Telegram alerting on queue exhaustion, startup failure, uncaught exceptions"
```

---

## Phase 2 — Features

---

### Task 5: Frontend — adapter-node Migration

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/svelte.config.js`
- Modify: `frontend/Dockerfile`
- Modify: `frontend/src/routes/run/[id]/+page.server.ts`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Swap the adapter package**

```bash
cd frontend && npm uninstall @sveltejs/adapter-static && npm install @sveltejs/adapter-node
```

- [ ] **Step 2: Update `frontend/svelte.config.js`**

```javascript
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};

export default config;
```

- [ ] **Step 3: Remove `entries` generator from detail page**

In `frontend/src/routes/run/[id]/+page.server.ts`, delete the `entries` export entirely. The file should only contain the `load` function:
```typescript
import { getActivity, getActivityPhotos } from '$lib/server/directus.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  try {
    const [activity, photos] = await Promise.all([
      getActivity(params.id),
      getActivityPhotos(params.id),
    ]);
    return { activity, photos };
  } catch {
    error(404, 'Activity not found');
  }
};
```

- [ ] **Step 4: Replace `frontend/Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_DIRECTUS_PUBLIC_URL
ENV VITE_DIRECTUS_PUBLIC_URL=$VITE_DIRECTUS_PUBLIC_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1
ENV PORT=3000
CMD ["node", "build/index.js"]
```

- [ ] **Step 5: Update `docker-compose.yml` frontend service**

Replace the `frontend` service block:
```yaml
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_DIRECTUS_PUBLIC_URL: "${DIRECTUS_PUBLIC_URL}"
    restart: unless-stopped
    networks:
      - internal
      - proxy
    env_file: .env
    environment:
      DIRECTUS_INTERNAL_URL: "http://directus:8055"
      PORT: "3000"
    depends_on:
      directus:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

- [ ] **Step 6: Verify build**

```bash
cd frontend && npm run build
```
Expected: `build/index.js` exists, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/package.json frontend/package-lock.json frontend/svelte.config.js \
  frontend/Dockerfile frontend/src/routes/run/[id]/+page.server.ts docker-compose.yml
git commit -m "feat(frontend): migrate from adapter-static/nginx to adapter-node — live SSR, no rebuild needed for new runs"
```

---

### Task 6: Health Dashboard

**Files:**
- Create: `frontend/src/routes/health/+page.server.ts`
- Create: `frontend/src/routes/health/+page.svelte`

- [ ] **Step 1: Create `frontend/src/routes/health/+page.server.ts`**

```typescript
import type { PageServerLoad } from './$types.js';
import { readItems } from '@directus/sdk';
import { createDirectus, rest, staticToken } from '@directus/sdk';

const DIRECTUS_URL = process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const WEBHOOK_URL = 'http://webhook-listener:3001/health';

async function ping(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const load: PageServerLoad = async () => {
  const c = createDirectus(DIRECTUS_URL).with(staticToken(DIRECTUS_TOKEN)).with(rest());

  const [directusOk, webhookOk, activityCount, photoCount, latestActivity] = await Promise.all([
    ping(`${DIRECTUS_URL}/server/health`),
    ping(WEBHOOK_URL),
    c.request(readItems('activities', { aggregate: { count: ['id'] }, limit: 1 }))
      .then((r) => (r as Array<{ count: { id: string } }>)[0]?.count?.id ?? '0')
      .catch(() => 'error'),
    c.request(readItems('photos', { aggregate: { count: ['id'] }, limit: 1 }))
      .then((r) => (r as Array<{ count: { id: string } }>)[0]?.count?.id ?? '0')
      .catch(() => 'error'),
    c.request(readItems('activities', { sort: ['-date'], limit: 1, fields: ['date', 'name'] }))
      .then((r) => (r as Array<{ date: string; name: string | null }>)[0] ?? null)
      .catch(() => null),
  ]);

  return { directusOk, webhookOk, activityCount, photoCount, latestActivity, checkedAt: new Date().toISOString() };
};
```

- [ ] **Step 2: Create `frontend/src/routes/health/+page.svelte`**

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <meta http-equiv="refresh" content="30" />
</svelte:head>

<main>
  <h1>System Health</h1>
  <p class="checked">Checked at {data.checkedAt}</p>

  <table>
    <tbody>
      <tr>
        <td class="label">Directus</td>
        <td class:ok={data.directusOk} class:fail={!data.directusOk}>{data.directusOk ? 'UP' : 'DOWN'}</td>
      </tr>
      <tr>
        <td class="label">Webhook listener</td>
        <td class:ok={data.webhookOk} class:fail={!data.webhookOk}>{data.webhookOk ? 'UP' : 'DOWN'}</td>
      </tr>
      <tr>
        <td class="label">Activities</td>
        <td>{data.activityCount}</td>
      </tr>
      <tr>
        <td class="label">Photos</td>
        <td>{data.photoCount}</td>
      </tr>
      <tr>
        <td class="label">Last synced</td>
        <td>{data.latestActivity ? `${data.latestActivity.date.slice(0, 10)} — ${data.latestActivity.name ?? 'Run'}` : '—'}</td>
      </tr>
    </tbody>
  </table>
</main>

<style>
  main { padding: 2rem; max-width: 480px; margin: 0 auto; }
  h1 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; }
  .checked { font-size: 0.75rem; color: var(--muted); margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  td { padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
  .label { color: var(--muted); width: 40%; }
  .ok { color: #22c55e; font-weight: 600; }
  .fail { color: #ef4444; font-weight: 600; }
</style>
```

- [ ] **Step 3: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/routes/health/
git commit -m "feat(frontend): health dashboard at /health — service status, activity counts, last sync"
```

---

### Task 7: Leaflet Map on Run Detail Page

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/routes/+layout.svelte`
- Create: `frontend/src/lib/components/RunMap.svelte`
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 1: Install leaflet**

```bash
cd frontend && npm install leaflet && npm install --save-dev @types/leaflet
```

- [ ] **Step 2: Add Leaflet CSS to `frontend/src/routes/+layout.svelte`**

Add to the `<script>` block at the top:
```svelte
<script>
  import 'leaflet/dist/leaflet.css';
  // ... existing imports
</script>
```

- [ ] **Step 3: Create `frontend/src/lib/components/RunMap.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import polylineLib from '@mapbox/polyline';

  let {
    summaryPolyline,
    startLat,
    startLng,
    height = '360px',
  }: {
    summaryPolyline: string;
    startLat: number | null;
    startLng: number | null;
    height?: string;
  } = $props();

  let mapEl: HTMLDivElement;

  onMount(async () => {
    const L = (await import('leaflet')).default;

    const coords = polylineLib.decode(summaryPolyline) as [number, number][];
    if (coords.length === 0) return;

    const map = L.map(mapEl);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    const polyline = L.polyline(coords, { color: '#f97316', weight: 3, opacity: 0.9 });
    polyline.addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [16, 16] });

    // Start marker (green dot)
    L.circleMarker(coords[0], {
      radius: 6,
      color: '#22c55e',
      fillColor: '#22c55e',
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);

    // Finish marker (orange dot)
    L.circleMarker(coords[coords.length - 1], {
      radius: 6,
      color: '#f97316',
      fillColor: '#f97316',
      fillOpacity: 1,
      weight: 2,
    }).addTo(map);

    return () => map.remove();
  });
</script>

<div bind:this={mapEl} style="height: {height}; width: 100%; background: #111;"></div>
```

- [ ] **Step 4: Replace static SVG with RunMap in `frontend/src/routes/run/[id]/+page.svelte`**

In the `<script>` block, add:
```svelte
  import RunMap from '$lib/components/RunMap.svelte';
```

Replace the `<div class="map-large">` block:
```svelte
      {#if activity.summary_polyline}
        <RunMap
          summaryPolyline={activity.summary_polyline}
          startLat={activity.start_lat}
          startLng={activity.start_lng}
        />
      {/if}
```

Remove the unused `decodePolyline` import from the utils import line if it is no longer used elsewhere in the file.

- [ ] **Step 5: Build and verify**

```bash
cd frontend && npm run build
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/package.json frontend/package-lock.json \
  frontend/src/routes/+layout.svelte \
  frontend/src/lib/components/RunMap.svelte \
  frontend/src/routes/run/[id]/+page.svelte
git commit -m "feat(frontend): interactive Leaflet map on run detail page, replaces static SVG"
```

---

### Task 8: Elevation Profile

**Files:**
- Create: `frontend/src/lib/components/ElevationProfile.svelte`
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 1: Create `frontend/src/lib/components/ElevationProfile.svelte`**

```svelte
<script lang="ts">
  interface Split {
    split: number;
    elevation_difference: number;
    distance: number;
  }

  let { splits }: { splits: Split[] } = $props();

  const WIDTH = 600;
  const HEIGHT = 120;
  const PAD = { top: 10, right: 10, bottom: 24, left: 36 };

  const chartWidth = $derived(WIDTH - PAD.left - PAD.right);
  const chartHeight = $derived(HEIGHT - PAD.top - PAD.bottom);

  // Build cumulative elevation from splits
  const points = $derived.by(() => {
    if (splits.length === 0) return [];
    const pts: Array<{ x: number; y: number; km: number; elev: number }> = [];
    let cumElev = 0;
    let cumDist = 0;
    pts.push({ x: 0, y: 0, km: 0, elev: 0 });
    for (const s of splits) {
      cumElev += s.elevation_difference;
      cumDist += s.distance / 1000;
      pts.push({ x: cumDist, y: cumElev, km: cumDist, elev: cumElev });
    }
    return pts;
  });

  const minElev = $derived(Math.min(...points.map((p) => p.y)));
  const maxElev = $derived(Math.max(...points.map((p) => p.y)));
  const maxDist = $derived(points.at(-1)?.x ?? 1);
  const elevRange = $derived(Math.max(maxElev - minElev, 10)); // avoid div by 0

  function toSvgX(km: number): number {
    return PAD.left + (km / maxDist) * chartWidth;
  }
  function toSvgY(elev: number): number {
    return PAD.top + chartHeight - ((elev - minElev) / elevRange) * chartHeight;
  }

  const pathD = $derived(
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ')
  );
  const areaD = $derived(
    pathD +
    ` L ${toSvgX(maxDist).toFixed(1)},${(PAD.top + chartHeight).toFixed(1)}` +
    ` L ${PAD.left},${(PAD.top + chartHeight).toFixed(1)} Z`
  );

  let hoveredPoint: { x: number; y: number; km: number; elev: number } | null = $state(null);

  function onMouseMove(e: MouseEvent) {
    const svg = (e.currentTarget as SVGElement).getBoundingClientRect();
    const mouseX = e.clientX - svg.left - PAD.left;
    const kmAtMouse = (mouseX / chartWidth) * maxDist;
    let closest = points[0];
    for (const p of points) {
      if (Math.abs(p.km - kmAtMouse) < Math.abs(closest.km - kmAtMouse)) closest = p;
    }
    hoveredPoint = closest;
  }
</script>

{#if points.length > 1}
  <div class="elevation">
    <div class="title">Elevation</div>
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="img"
      aria-label="Elevation profile"
      onmousemove={onMouseMove}
      onmouseleave={() => hoveredPoint = null}
    >
      <!-- Area fill -->
      <path d={areaD} fill="#f97316" opacity="0.15" />
      <!-- Line -->
      <path d={pathD} fill="none" stroke="#f97316" stroke-width="1.5" />

      <!-- Hover indicator -->
      {#if hoveredPoint}
        <line
          x1={toSvgX(hoveredPoint.x)}
          y1={PAD.top}
          x2={toSvgX(hoveredPoint.x)}
          y2={PAD.top + chartHeight}
          stroke="#f97316"
          stroke-width="1"
          opacity="0.5"
          stroke-dasharray="3,3"
        />
        <circle cx={toSvgX(hoveredPoint.x)} cy={toSvgY(hoveredPoint.y)} r="3" fill="#f97316" />
        <text x={toSvgX(hoveredPoint.x)} y={PAD.top - 2} text-anchor="middle" font-size="9" fill="#f97316">
          {hoveredPoint.km.toFixed(1)}km · {Math.round(hoveredPoint.elev)}m
        </text>
      {/if}

      <!-- Baseline -->
      <line x1={PAD.left} y1={PAD.top + chartHeight} x2={PAD.left + chartWidth} y2={PAD.top + chartHeight} stroke="#333" stroke-width="1" />

      <!-- Y axis label -->
      <text x={PAD.left - 4} y={PAD.top + chartHeight / 2} text-anchor="end" dominant-baseline="middle" font-size="8" fill="#666">
        {Math.round(minElev)}m
      </text>
      <text x={PAD.left - 4} y={PAD.top} text-anchor="end" dominant-baseline="hanging" font-size="8" fill="#666">
        {Math.round(maxElev)}m
      </text>
    </svg>
  </div>
{/if}

<style>
  .elevation { margin-top: 1rem; }
  .title { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 0.5rem; }
  svg { width: 100%; display: block; cursor: crosshair; }
</style>
```

- [ ] **Step 2: Add ElevationProfile to `frontend/src/routes/run/[id]/+page.svelte`**

In the `<script>` block, add:
```svelte
  import ElevationProfile from '$lib/components/ElevationProfile.svelte';
```

After the `<RunMap ... />` block (or after the map-large div), add:
```svelte
      <ElevationProfile {splits} />
```

The `splits` variable is already computed in the existing script:
```svelte
  const splits: Array<{ split: number; average_speed: number; moving_time: number; average_heartrate?: number }> = $derived.by(...)
```

Update the splits type to include `elevation_difference` and `distance`:
```typescript
  const splits: Array<{
    split: number;
    average_speed: number;
    moving_time: number;
    average_heartrate?: number;
    elevation_difference: number;
    distance: number;
  }> = $derived.by(() => {
    if (!activity.splits_metric) return [];
    try { return JSON.parse(activity.splits_metric); } catch { return []; }
  });
```

- [ ] **Step 3: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/components/ElevationProfile.svelte \
  frontend/src/routes/run/[id]/+page.svelte
git commit -m "feat(frontend): elevation profile SVG chart on run detail page"
```

---

### Task 9: Grid Filters

**Files:**
- Modify: `frontend/src/lib/server/directus.ts`
- Modify: `frontend/src/routes/+page.server.ts`
- Modify: `frontend/src/routes/+page.svelte`

- [ ] **Step 1: Add `type` and `sport_type` to `getAllActivities` fields**

In `frontend/src/lib/server/directus.ts`, in the `getAllActivities` function, add `'type'` and `'sport_type'` to the fields array:
```typescript
      fields: ['id', 'strava_id', 'date', 'name', 'route_name', 'distance_m', 'moving_time_s',
               'average_speed', 'average_heartrate', 'summary_polyline', 'total_elevation_gain',
               'type', 'sport_type'],
```

Also add `type: string | null; sport_type: string | null;` to the `Activity` interface.

- [ ] **Step 2: Update `frontend/src/routes/+page.server.ts`**

Replace with:
```typescript
import { getAllActivities } from '$lib/server/directus.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  const activities = await getAllActivities();
  return { activities };
};
```

(No change in logic, just ensuring it's clean after the type update.)

- [ ] **Step 3: Replace `frontend/src/routes/+page.svelte` with filter support**

Add to the `<script>` block (after existing imports):
```svelte
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';

  // Derive available years from data
  const years = $derived(
    [...new Set(data.activities.map((a) => new Date(a.date).getFullYear()))].sort((a, b) => b - a)
  );

  // Read filters from URL
  let selectedYear = $state($page.url.searchParams.get('year') ?? 'all');
  let selectedDist = $state($page.url.searchParams.get('dist') ?? 'all');

  // Dist buckets: label → [minM, maxM | null]
  const DIST_BUCKETS: Record<string, [number, number | null]> = {
    '0-5': [0, 5000],
    '5-10': [5000, 10000],
    '10-21': [10000, 21097],
    '21+': [21097, null],
  };

  const filtered = $derived(data.activities.filter((a) => {
    if (selectedYear !== 'all' && new Date(a.date).getFullYear() !== Number(selectedYear)) return false;
    if (selectedDist !== 'all') {
      const [min, max] = DIST_BUCKETS[selectedDist] ?? [0, null];
      const d = a.distance_m ?? 0;
      if (d < min) return false;
      if (max !== null && d >= max) return false;
    }
    return true;
  }));

  function updateFilters() {
    const params = new URLSearchParams();
    if (selectedYear !== 'all') params.set('year', selectedYear);
    if (selectedDist !== 'all') params.set('dist', selectedDist);
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true });
  }
```

In the template, replace `<header>` block with:
```svelte
  <header>
    <div class="title-row">
      <h1>All runs</h1>
      <p class="count">{filtered.length} of {data.activities.length}</p>
    </div>
    <div class="filters">
      <select bind:value={selectedYear} onchange={updateFilters}>
        <option value="all">All years</option>
        {#each years as y}<option value={y}>{y}</option>{/each}
      </select>
      <select bind:value={selectedDist} onchange={updateFilters}>
        <option value="all">Any distance</option>
        <option value="0-5">0–5 km</option>
        <option value="5-10">5–10 km</option>
        <option value="10-21">10–21 km</option>
        <option value="21+">21+ km</option>
      </select>
    </div>
  </header>
```

Replace `{#each data.activities as activity (activity.id)}` with `{#each filtered as activity (activity.id)}`.

Add to `<style>`:
```css
  .title-row { display: flex; align-items: baseline; gap: 1rem; }
  .filters { display: flex; gap: 0.75rem; margin-top: 0.75rem; flex-wrap: wrap; }
  select {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
    border-radius: 4px;
    cursor: pointer;
  }
  select:hover { border-color: var(--accent); }
```

- [ ] **Step 4: Build**

```bash
cd frontend && npm run build
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/server/directus.ts \
  frontend/src/routes/+page.server.ts \
  frontend/src/routes/+page.svelte
git commit -m "feat(frontend): year and distance filters on run grid, state in URL params"
```

---

### Task 10: Calendar Heatmap

**Files:**
- Create: `frontend/src/lib/components/CalendarHeatmap.svelte`
- Modify: `frontend/src/routes/stats/+page.server.ts`
- Modify: `frontend/src/routes/stats/+page.svelte`

- [ ] **Step 1: Add daily stats to `frontend/src/routes/stats/+page.server.ts`**

At the end of the `load` function, after building `weekly`, add:
```typescript
  // Build daily map: "YYYY-MM-DD" → { total_km: number, first_activity_id: string }
  const dailyMap = new Map<string, { total_km: number; first_activity_id: string }>();
  for (const a of activities) {
    const day = a.date.slice(0, 10);
    if (!dailyMap.has(day)) {
      dailyMap.set(day, { total_km: 0, first_activity_id: a.id });
    }
    dailyMap.get(day)!.total_km += (a.distance_m ?? 0) / 1000;
  }
  const daily = Object.fromEntries(dailyMap);
```

Update the return to include `daily`:
```typescript
  return { weekly, records, daily };
```

- [ ] **Step 2: Create `frontend/src/lib/components/CalendarHeatmap.svelte`**

```svelte
<script lang="ts">
  type DayData = { total_km: number; first_activity_id: string };

  let { daily }: { daily: Record<string, DayData> } = $props();

  const CELL = 11;
  const GAP = 2;
  const COLS = 53; // weeks
  const ROWS = 7;  // days (Mon–Sun)
  const LEFT_PAD = 24;
  const TOP_PAD = 16;

  // Build a grid of 53×7 cells starting from the Monday of 52 weeks ago
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find the Monday of the week 52 weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  // Align to Monday (getDay: 0=Sun, 1=Mon ... 6=Sat)
  const dayOffset = (start.getDay() + 6) % 7; // Mon=0
  start.setDate(start.getDate() - dayOffset);

  interface Cell {
    date: string;
    col: number;
    row: number;
    total_km: number;
    first_activity_id: string | null;
  }

  const cells: Cell[] = $derived.by(() => {
    const result: Cell[] = [];
    const maxKm = Math.max(...Object.values(daily).map((d) => d.total_km), 1);
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const d = new Date(start);
        d.setDate(d.getDate() + col * 7 + row);
        if (d > today) continue;
        const dateStr = d.toISOString().slice(0, 10);
        const data = daily[dateStr];
        result.push({
          date: dateStr,
          col,
          row,
          total_km: data?.total_km ?? 0,
          first_activity_id: data?.first_activity_id ?? null,
        });
      }
    }
    return result;
  });

  function cellColor(km: number): string {
    if (km === 0) return '#1c1c1c';
    const maxKm = Math.max(...cells.map((c) => c.total_km), 1);
    const t = Math.min(km / maxKm, 1);
    // Scale from dim orange to bright orange
    const alpha = 0.2 + t * 0.8;
    return `rgba(249,115,22,${alpha.toFixed(2)})`;
  }

  const SVG_W = LEFT_PAD + COLS * (CELL + GAP);
  const SVG_H = TOP_PAD + ROWS * (CELL + GAP);

  const MONTH_LABELS = $derived.by(() => {
    const labels: Array<{ label: string; x: number }> = [];
    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      const d = new Date(start);
      d.setDate(d.getDate() + col * 7);
      const m = d.getMonth();
      if (m !== lastMonth) {
        labels.push({ label: d.toLocaleString('en', { month: 'short' }), x: LEFT_PAD + col * (CELL + GAP) });
        lastMonth = m;
      }
    }
    return labels;
  });
</script>

<div class="heatmap">
  <svg viewBox="0 0 {SVG_W} {SVG_H}" role="img" aria-label="Activity calendar">
    {#each MONTH_LABELS as { label, x }}
      <text {x} y="10" font-size="8" fill="#666">{label}</text>
    {/each}

    {#each cells as cell (cell.date)}
      {@const cx = LEFT_PAD + cell.col * (CELL + GAP)}
      {@const cy = TOP_PAD + cell.row * (CELL + GAP)}
      {#if cell.first_activity_id}
        <a href="/run/{cell.first_activity_id}" aria-label="{cell.date}: {cell.total_km.toFixed(1)} km">
          <rect x={cx} y={cy} width={CELL} height={CELL} rx="2" fill={cellColor(cell.total_km)}>
            <title>{cell.date}: {cell.total_km.toFixed(1)} km</title>
          </rect>
        </a>
      {:else}
        <rect x={cx} y={cy} width={CELL} height={CELL} rx="2" fill={cellColor(cell.total_km)} />
      {/if}
    {/each}
  </svg>
</div>

<style>
  .heatmap { overflow-x: auto; }
  svg { min-width: 600px; width: 100%; display: block; }
  a { text-decoration: none; }
  a rect:hover { opacity: 0.75; }
</style>
```

- [ ] **Step 3: Add CalendarHeatmap to `frontend/src/routes/stats/+page.svelte`**

In `<script>` add:
```svelte
  import CalendarHeatmap from '$lib/components/CalendarHeatmap.svelte';
```

Add a section above or below the weekly chart:
```svelte
  <section class="section">
    <h2>Activity calendar</h2>
    <CalendarHeatmap daily={data.daily} />
  </section>
```

Add a `section` style if not already present:
```css
  .section { margin-bottom: 2.5rem; }
  .section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); margin-bottom: 1rem; }
```

- [ ] **Step 4: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/components/CalendarHeatmap.svelte \
  frontend/src/routes/stats/+page.server.ts \
  frontend/src/routes/stats/+page.svelte
git commit -m "feat(frontend): GitHub-style activity calendar heatmap on stats page"
```

---

### Task 11: Year-in-Review Pages

**Files:**
- Create: `frontend/src/routes/[year]/+page.server.ts`
- Create: `frontend/src/routes/[year]/+page.svelte`

- [ ] **Step 1: Create `frontend/src/routes/[year]/+page.server.ts`**

```typescript
import { getAllActivities } from '$lib/server/directus.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params }) => {
  const year = parseInt(params.year, 10);
  if (isNaN(year) || year < 2000 || year > 2100) error(404, 'Not found');

  const all = await getAllActivities();
  const activities = all.filter((a) => new Date(a.date).getFullYear() === year);
  if (activities.length === 0) error(404, `No runs in ${year}`);

  const totalDistM = activities.reduce((s, a) => s + (a.distance_m ?? 0), 0);
  const totalTimS = activities.reduce((s, a) => s + (a.moving_time_s ?? 0), 0);
  const totalElev = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);
  const longest = activities.reduce((best, a) => (a.distance_m ?? 0) > (best.distance_m ?? 0) ? a : best);
  const fastest = activities
    .filter((a) => (a.distance_m ?? 0) >= 5000 && a.average_speed)
    .reduce((best, a) => (a.average_speed ?? 0) > (best.average_speed ?? 0) ? a : best, activities[0]);

  const allYears = [...new Set(all.map((a) => new Date(a.date).getFullYear()))].sort();
  const idx = allYears.indexOf(year);
  const prevYear = idx > 0 ? allYears[idx - 1] : null;
  const nextYear = idx < allYears.length - 1 ? allYears[idx + 1] : null;

  return { year, activities, totalDistM, totalTimS, totalElev, longest, fastest, prevYear, nextYear };
};
```

- [ ] **Step 2: Create `frontend/src/routes/[year]/+page.svelte`**

```svelte
<script lang="ts">
  import type { PageData } from './$types.js';
  import { formatDistance, formatPace, formatDate, formatDuration, polylineToSvgPath } from '$lib/utils.js';

  let { data }: { data: PageData } = $props();

  const totalHours = $derived(Math.round(data.totalTimS / 3600));
</script>

<main>
  <div class="back"><a href="/stats">&larr; Stats</a></div>

  <header>
    <div class="year-nav">
      {#if data.prevYear}<a href="/{data.prevYear}" class="nav-arrow">&#8249;</a>{:else}<span class="nav-arrow disabled">&#8249;</span>{/if}
      <h1>{data.year}</h1>
      {#if data.nextYear}<a href="/{data.nextYear}" class="nav-arrow">&#8250;</a>{:else}<span class="nav-arrow disabled">&#8250;</span>{/if}
    </div>
    <p class="sub">{data.activities.length} runs</p>
  </header>

  <div class="summary">
    <div class="stat-item"><div class="label">Distance</div><div class="value">{formatDistance(data.totalDistM)}</div></div>
    <div class="stat-item"><div class="label">Time</div><div class="value">{totalHours} h</div></div>
    <div class="stat-item"><div class="label">Elevation</div><div class="value">{Math.round(data.totalElev)} m</div></div>
  </div>

  {#if data.longest}
    <div class="highlights">
      <div class="highlight">
        <div class="label">Longest run</div>
        <a href="/run/{data.longest.id}" class="hl-link">{formatDistance(data.longest.distance_m)} — {formatDate(data.longest.date)}</a>
      </div>
      {#if data.fastest && data.fastest.id !== data.longest.id}
        <div class="highlight">
          <div class="label">Fastest pace</div>
          <a href="/run/{data.fastest.id}" class="hl-link">{formatPace(data.fastest.average_speed)} /km — {formatDate(data.fastest.date)}</a>
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid">
    {#each data.activities as activity (activity.id)}
      <a href="/run/{activity.id}" class="card">
        <div class="map">
          {#if activity.summary_polyline}
            <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <polyline
                points={polylineToSvgPath(activity.summary_polyline)}
                fill="none"
                stroke="var(--accent)"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {:else}
            <div class="no-map">no route</div>
          {/if}
        </div>
        <div class="info">
          <time class="date">{formatDate(activity.date)}</time>
          <div class="stats">
            <span>{formatDistance(activity.distance_m)}</span>
            <span class="sep">·</span>
            <span>{formatPace(activity.average_speed)}</span>
          </div>
        </div>
      </a>
    {/each}
  </div>
</main>

<style>
  main { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
  .back { margin-bottom: 1rem; font-size: 0.85rem; color: var(--muted); }
  .year-nav { display: flex; align-items: center; gap: 1rem; }
  h1 { font-size: 2rem; font-weight: 700; }
  .nav-arrow { font-size: 1.8rem; color: var(--muted); line-height: 1; }
  .nav-arrow:not(.disabled):hover { color: var(--accent); }
  .nav-arrow.disabled { opacity: 0.2; cursor: default; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; margin-bottom: 1.5rem; }
  .summary { display: flex; gap: 1px; background: var(--border); border: 1px solid var(--border); margin-bottom: 1.5rem; max-width: 480px; }
  .stat-item { background: var(--bg); padding: 0.75rem 1.25rem; flex: 1; }
  .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.2rem; }
  .value { font-size: 1.2rem; font-weight: 500; }
  .highlights { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
  .highlight .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; margin-bottom: 0.1rem; }
  .hl-link { font-size: 0.9rem; color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); }
  .card { background: var(--bg); display: flex; flex-direction: column; transition: background 0.15s; }
  .card:hover { background: var(--surface); }
  .map { aspect-ratio: 5/3; background: #111; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .map svg { width: 100%; height: 100%; }
  .no-map { color: var(--border); font-size: 0.7rem; text-transform: uppercase; }
  .info { padding: 0.5rem 0.65rem; }
  .date { font-size: 0.7rem; color: var(--muted); display: block; margin-bottom: 0.15rem; }
  .stats { font-size: 0.78rem; color: var(--muted); }
  .sep { margin: 0 0.2rem; }
</style>
```

- [ ] **Step 3: Add year-in-review links to the stats page**

In `frontend/src/routes/stats/+page.server.ts`, after building `daily`, add:
```typescript
  const availableYears = [...new Set(activities.map((a) => new Date(a.date).getFullYear()))].sort((a, b) => b - a);
```

Add to the return: `availableYears`.

In `frontend/src/routes/stats/+page.svelte`, add a year list:
```svelte
  <section class="section">
    <h2>By year</h2>
    <div class="year-links">
      {#each data.availableYears as y}
        <a href="/{y}" class="year-chip">{y}</a>
      {/each}
    </div>
  </section>
```

Add style:
```css
  .year-links { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .year-chip { font-size: 0.85rem; padding: 0.3rem 0.8rem; border: 1px solid var(--border); border-radius: 2rem; color: var(--muted); }
  .year-chip:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 4: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/routes/[year]/ \
  frontend/src/routes/stats/+page.server.ts \
  frontend/src/routes/stats/+page.svelte
git commit -m "feat(frontend): year-in-review pages at /[year] with summary stats, highlights, and run grid"
```

---

### Task 12: Stats Calculations Library

**Files:**
- Create: `frontend/src/lib/stats.ts`
- Create: `frontend/src/lib/stats.test.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add vitest to frontend**

```bash
cd frontend && npm install --save-dev vitest
```

Add to `frontend/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 2: Write failing tests**

Create `frontend/src/lib/stats.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { calculateStreaks, calculatePersonalBests, MILESTONES } from './stats.js';

describe('calculateStreaks', () => {
  it('returns 0 for no activities', () => {
    const { longest, current } = calculateStreaks([]);
    expect(longest).toBe(0);
    expect(current).toBe(0);
  });

  it('counts a single run as streak of 1', () => {
    const { longest, current } = calculateStreaks(['2024-01-01']);
    expect(longest).toBe(1);
  });

  it('counts consecutive days', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(longest).toBe(3);
  });

  it('resets on a gap', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-02', '2024-01-05', '2024-01-06']);
    expect(longest).toBe(2);
  });

  it('deduplicates multiple runs on same day', () => {
    const { longest } = calculateStreaks(['2024-01-01', '2024-01-01', '2024-01-02']);
    expect(longest).toBe(2);
  });
});

describe('calculatePersonalBests', () => {
  it('returns null for no activities', () => {
    const pbs = calculatePersonalBests([]);
    expect(pbs['5k']).toBeNull();
  });

  it('finds the minimum elapsed_time for a distance', () => {
    const activities = [
      { id: '1', date: '2024-01-01', best_efforts: JSON.stringify([{ name: '5k', elapsed_time: 1500, moving_time: 1500 }]) },
      { id: '2', date: '2024-02-01', best_efforts: JSON.stringify([{ name: '5k', elapsed_time: 1400, moving_time: 1400 }]) },
    ];
    const pbs = calculatePersonalBests(activities as never);
    expect(pbs['5k']?.elapsed_time).toBe(1400);
    expect(pbs['5k']?.activity_id).toBe('2');
  });
});

describe('MILESTONES', () => {
  it('has at least 2 entries', () => {
    expect(MILESTONES.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run — confirm it fails**

```bash
cd frontend && npm test -- stats.test.ts
```
Expected: `Cannot find module './stats.js'`

- [ ] **Step 4: Create `frontend/src/lib/stats.ts`**

```typescript
interface ActivityForStats {
  id: string;
  date: string;
  best_efforts: string | null;
}

export interface PersonalBest {
  elapsed_time: number;
  activity_id: string;
  date: string;
}

export interface MilestoneConfig {
  label: string;
  unit: 'km' | 'hours' | 'm_elev';
  fun: (value: number) => string;
}

// Sweden N–S = ~1,574 km. Everest = 8,849 m.
export const MILESTONES: MilestoneConfig[] = [
  {
    label: 'Total distance',
    unit: 'km',
    fun: (km) => {
      const swedens = km / 1574;
      if (swedens >= 0.5) return `${swedens.toFixed(1)}× the length of Sweden`;
      return `${(km / 42.195).toFixed(0)} marathons`;
    },
  },
  {
    label: 'Total elevation',
    unit: 'm_elev',
    fun: (m) => {
      const everests = m / 8849;
      return `${everests.toFixed(1)}× the height of Everest`;
    },
  },
  {
    label: 'Total time',
    unit: 'hours',
    fun: (h) => `${h.toFixed(0)} hours — ${(h / 24).toFixed(1)} days on your feet`,
  },
];

// Distance name → key used in PBs map
const BEST_EFFORT_MAP: Record<string, string> = {
  '400m': '400m',
  '1/2 mile': 'half_mile',
  '1k': '1k',
  '1 mile': '1mile',
  '5k': '5k',
  '10k': '10k',
  'Half-Marathon': 'half_marathon',
  'Marathon': 'marathon',
};

export type PersonalBests = Record<string, PersonalBest | null>;

export function calculatePersonalBests(activities: ActivityForStats[]): PersonalBests {
  const result: PersonalBests = {};
  for (const key of Object.values(BEST_EFFORT_MAP)) result[key] = null;

  for (const a of activities) {
    if (!a.best_efforts) continue;
    let efforts: Array<{ name: string; elapsed_time: number }>;
    try { efforts = JSON.parse(a.best_efforts); } catch { continue; }

    for (const e of efforts) {
      const key = BEST_EFFORT_MAP[e.name];
      if (!key) continue;
      const current = result[key];
      if (!current || e.elapsed_time < current.elapsed_time) {
        result[key] = { elapsed_time: e.elapsed_time, activity_id: a.id, date: a.date };
      }
    }
  }
  return result;
}

export function calculateStreaks(dates: string[]): { longest: number; current: number } {
  if (dates.length === 0) return { longest: 0, current: 0 };

  const unique = [...new Set(dates)].sort();
  let longest = 1;
  let streak = 1;

  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(unique[i - 1]);
    const curr = new Date(unique[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / 86400000;
    if (diffDays === 1) {
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 1;
    }
  }

  // Current streak: count back from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let current = 0;
  for (let i = unique.length - 1; i >= 0; i--) {
    const d = new Date(unique[i]);
    const expected = new Date(today);
    expected.setDate(today.getDate() - current);
    if (d.getTime() === expected.getTime()) {
      current++;
    } else {
      break;
    }
  }

  return { longest, current };
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd frontend && npm test -- stats.test.ts
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/stats.ts frontend/src/lib/stats.test.ts frontend/package.json
git commit -m "feat(frontend): stats calculation library — streaks, personal bests, milestones"
```

---

### Task 13: Expanded Stats Dashboard

**Files:**
- Modify: `frontend/src/lib/server/directus.ts`
- Modify: `frontend/src/routes/stats/+page.server.ts`
- Create: `frontend/src/lib/components/BarChart.svelte`
- Create: `frontend/src/lib/components/LineChart.svelte`
- Modify: `frontend/src/routes/stats/+page.svelte`
- Modify: `frontend/package.json`

- [ ] **Step 1: Install Chart.js**

```bash
cd frontend && npm install chart.js
```

- [ ] **Step 2: Add `best_efforts` and `splits_metric` to `getAllActivities` fields**

In `frontend/src/lib/server/directus.ts`, update the `getAllActivities` fields array:
```typescript
      fields: [
        'id', 'strava_id', 'date', 'name', 'route_name', 'distance_m', 'moving_time_s',
        'average_speed', 'average_heartrate', 'summary_polyline', 'total_elevation_gain',
        'type', 'sport_type', 'best_efforts',
      ],
```

Add `best_efforts: string | null;` to the `Activity` interface.

- [ ] **Step 3: Expand `frontend/src/routes/stats/+page.server.ts`**

Add imports at top:
```typescript
import { calculateStreaks, calculatePersonalBests, MILESTONES } from '$lib/stats.js';
```

In the `load` function, after building `daily`, add:

```typescript
  // Lifetime milestones
  const totalKm = activities.reduce((s, a) => s + (a.distance_m ?? 0) / 1000, 0);
  const totalHours = activities.reduce((s, a) => s + (a.moving_time_s ?? 0) / 3600, 0);
  const totalElevM = activities.reduce((s, a) => s + (a.total_elevation_gain ?? 0), 0);

  const milestones = MILESTONES.map((m) => {
    const value = m.unit === 'km' ? totalKm : m.unit === 'hours' ? totalHours : totalElevM;
    return { label: m.label, value: Math.round(value), fun: m.fun(value) };
  });

  // Streaks
  const streaks = calculateStreaks(activities.map((a) => a.date.slice(0, 10)));

  // Personal bests — dynamically calculated
  const personalBests = calculatePersonalBests(activities);

  // Year-over-year
  const yoyMap = new Map<number, { dist_km: number; runs: number; elev: number }>();
  for (const a of activities) {
    const y = new Date(a.date).getFullYear();
    if (!yoyMap.has(y)) yoyMap.set(y, { dist_km: 0, runs: 0, elev: 0 });
    const r = yoyMap.get(y)!;
    r.dist_km += (a.distance_m ?? 0) / 1000;
    r.runs += 1;
    r.elev += a.total_elevation_gain ?? 0;
  }
  const yoy = Array.from(yoyMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, d]) => ({ year, dist_km: Math.round(d.dist_km), runs: d.runs, elev: Math.round(d.elev) }));

  // Pace trends — average pace (s/km) per calendar month
  const paceMap = new Map<string, { sum_s_km: number; count: number }>();
  for (const a of activities) {
    if (!a.average_speed || !a.distance_m || a.distance_m < 3000) continue;
    const month = a.date.slice(0, 7); // YYYY-MM
    if (!paceMap.has(month)) paceMap.set(month, { sum_s_km: 0, count: 0 });
    const p = paceMap.get(month)!;
    p.sum_s_km += 1000 / a.average_speed; // s per km
    p.count++;
  }
  const paceTrends = Array.from(paceMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({ month, avg_s_km: Math.round(d.sum_s_km / d.count) }));
```

Update return:
```typescript
  return { weekly, records, daily, availableYears, milestones, streaks, personalBests, yoy, paceTrends };
```

- [ ] **Step 4: Create `frontend/src/lib/components/BarChart.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let {
    labels,
    datasets,
    yLabel = '',
  }: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color: string }>;
    yLabel?: string;
  } = $props();

  let canvas: HTMLCanvasElement;

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.color,
          borderRadius: 3,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
        },
        scales: {
          x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
          y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, title: { display: !!yLabel, text: yLabel, color: '#8b949e' } },
        },
      },
    });
    return () => chart.destroy();
  });
</script>

<canvas bind:this={canvas}></canvas>
```

- [ ] **Step 5: Create `frontend/src/lib/components/LineChart.svelte`**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';

  let {
    labels,
    datasets,
    yLabel = '',
    yFormat,
  }: {
    labels: string[];
    datasets: Array<{ label: string; data: number[]; color: string }>;
    yLabel?: string;
    yFormat?: (v: number) => string;
  } = $props();

  let canvas: HTMLCanvasElement;

  onMount(async () => {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: d.color,
          backgroundColor: d.color + '22',
          tension: 0.3,
          pointRadius: 2,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#8b949e', font: { size: 11 } } },
          tooltip: {
            callbacks: yFormat ? { label: (ctx) => yFormat(ctx.parsed.y) } : {},
          },
        },
        scales: {
          x: { ticks: { color: '#8b949e', maxTicksLimit: 12 }, grid: { color: '#21262d' } },
          y: {
            ticks: { color: '#8b949e', callback: yFormat ? (v) => yFormat(v as number) : undefined },
            grid: { color: '#21262d' },
            title: { display: !!yLabel, text: yLabel, color: '#8b949e' },
          },
        },
      },
    });
    return () => chart.destroy();
  });
</script>

<canvas bind:this={canvas}></canvas>
```

- [ ] **Step 6: Expand `frontend/src/routes/stats/+page.svelte`**

Add imports to `<script>`:
```svelte
  import BarChart from '$lib/components/BarChart.svelte';
  import LineChart from '$lib/components/LineChart.svelte';
```

Format pace helper in script:
```typescript
  function fmtPace(s_km: number): string {
    const m = Math.floor(s_km / 60);
    const s = Math.round(s_km % 60);
    return `${m}:${String(s).padStart(2, '0')} /km`;
  }
```

Add the following sections in the template (below existing weekly chart):

**Milestones section:**
```svelte
  <section class="section">
    <h2>Lifetime totals</h2>
    <div class="milestone-grid">
      {#each data.milestones as m}
        <div class="milestone">
          <div class="label">{m.label}</div>
          <div class="value">{m.value.toLocaleString()}</div>
          <div class="fun">{m.fun}</div>
        </div>
      {/each}
    </div>
  </section>
```

**Streaks section:**
```svelte
  <section class="section">
    <h2>Running streaks</h2>
    <div class="streak-row">
      <div class="milestone"><div class="label">Longest streak</div><div class="value">{data.streaks.longest} days</div></div>
      <div class="milestone"><div class="label">Current streak</div><div class="value">{data.streaks.current} days</div></div>
    </div>
  </section>
```

**YoY chart:**
```svelte
  <section class="section">
    <h2>Year over year</h2>
    <BarChart
      labels={data.yoy.map((y) => String(y.year))}
      datasets={[
        { label: 'Distance (km)', data: data.yoy.map((y) => y.dist_km), color: '#f97316' },
        { label: 'Runs', data: data.yoy.map((y) => y.runs), color: '#3b82f6' },
      ]}
      yLabel="km / runs"
    />
  </section>
```

**Pace trends chart:**
```svelte
  <section class="section">
    <h2>Pace trends</h2>
    <LineChart
      labels={data.paceTrends.map((p) => p.month)}
      datasets={[{ label: 'Avg pace', data: data.paceTrends.map((p) => p.avg_s_km), color: '#f97316' }]}
      yLabel="pace (s/km)"
      yFormat={fmtPace}
    />
  </section>
```

**Personal bests table:**
```svelte
  <section class="section">
    <h2>Personal bests</h2>
    <table class="pb-table">
      <thead><tr><th>Distance</th><th>Time</th><th>Pace</th><th>Date</th></tr></thead>
      <tbody>
        {#each [['5k','5K'],['10k','10K'],['half_marathon','Half marathon'],['marathon','Marathon'],['1k','1K'],['1mile','1 mile']] as [key, label]}
          {@const pb = data.personalBests[key]}
          <tr>
            <td>{label}</td>
            {#if pb}
              <td><a href="/run/{pb.activity_id}">{formatDuration(pb.elapsed_time)}</a></td>
              <td>{fmtPace(pb.elapsed_time / (key === '5k' ? 5 : key === '10k' ? 10 : key === 'half_marathon' ? 21.097 : key === 'marathon' ? 42.195 : key === '1k' ? 1 : 1.609))}</td>
              <td>{pb.date.slice(0, 10)}</td>
            {:else}
              <td colspan="3" class="muted">—</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
```

Add styles:
```css
  .milestone-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); }
  .milestone { background: var(--bg); padding: 1rem; }
  .fun { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
  .streak-row { display: flex; gap: 1px; background: var(--border); border: 1px solid var(--border); max-width: 360px; }
  .pb-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .pb-table th { text-align: left; padding: 0.5rem 0.75rem; color: var(--muted); font-weight: 400; border-bottom: 1px solid var(--border); }
  .pb-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  .pb-table a { color: var(--accent); }
  .muted { color: var(--muted); }
```

- [ ] **Step 7: Build**

```bash
cd frontend && npm run build
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/server/directus.ts \
  frontend/src/routes/stats/+page.server.ts \
  frontend/src/lib/components/BarChart.svelte \
  frontend/src/lib/components/LineChart.svelte \
  frontend/src/routes/stats/+page.svelte \
  frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): expanded stats dashboard — milestones, streaks, YoY chart, pace trends, personal bests"
```

---

### Task 14: Photo Thumbnails on Grid Cards

**Files:**
- Modify: `frontend/src/lib/server/directus.ts`
- Modify: `frontend/src/routes/+page.svelte`

- [ ] **Step 1: Add photo relation to `getAllActivities`**

In `frontend/src/lib/server/directus.ts`, add `'photos.directus_file_id'` to the fields array in `getAllActivities`:
```typescript
      fields: [
        'id', 'strava_id', 'date', 'name', 'route_name', 'distance_m', 'moving_time_s',
        'average_speed', 'average_heartrate', 'summary_polyline', 'total_elevation_gain',
        'type', 'sport_type', 'best_efforts',
        'photos.directus_file_id',
      ],
```

Update the `Activity` interface to include the nested photos:
```typescript
  photos?: Array<{ directus_file_id: string | null }>;
```

- [ ] **Step 2: Update `frontend/src/routes/+page.svelte` to show photo thumbnail**

Add to script:
```svelte
  const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_PUBLIC_URL ?? '';
```

In the card `.map` div, update the content to show photo if available, falling back to SVG:
```svelte
        <div class="map">
          {#if activity.photos?.[0]?.directus_file_id}
            <img
              src="{DIRECTUS_URL}/assets/{activity.photos[0].directus_file_id}?width=240&height=144&fit=cover&quality=70"
              alt=""
              loading="lazy"
              class="thumb"
            />
          {:else if activity.summary_polyline}
            <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <polyline
                points={polylineToSvgPath(activity.summary_polyline)}
                fill="none"
                stroke="var(--accent)"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {:else}
            <div class="no-map">no route</div>
          {/if}
        </div>
```

Add to `<style>`:
```css
  .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
```

- [ ] **Step 3: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/server/directus.ts frontend/src/routes/+page.svelte
git commit -m "feat(frontend): photo thumbnail on grid cards, falls back to SVG route if no photo"
```

---

### Task 15: Photo Lightbox

**Files:**
- Create: `frontend/src/lib/components/Lightbox.svelte`
- Modify: `frontend/src/routes/run/[id]/+page.svelte`

- [ ] **Step 1: Create `frontend/src/lib/components/Lightbox.svelte`**

```svelte
<script lang="ts">
  let {
    photos,
    directusUrl,
  }: {
    photos: Array<{ id: string; directus_file_id: string | null; caption: string | null }>;
    directusUrl: string;
  } = $props();

  const visible = $derived(photos.filter((p) => p.directus_file_id));

  let openIndex: number | null = $state(null);

  function open(i: number) { openIndex = i; }
  function close() { openIndex = null; }
  function prev() { if (openIndex !== null && openIndex > 0) openIndex--; }
  function next() { if (openIndex !== null && openIndex < visible.length - 1) openIndex++; }

  function onKeydown(e: KeyboardEvent) {
    if (openIndex === null) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') prev();
    if (e.key === 'ArrowRight') next();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if visible.length > 0}
  <div class="gallery">
    {#each visible as photo, i (photo.id)}
      <button class="thumb-btn" onclick={() => open(i)} aria-label={photo.caption ?? `Photo ${i + 1}`}>
        <img
          src="{directusUrl}/assets/{photo.directus_file_id}?width=200&height=150&fit=cover&quality=70"
          alt={photo.caption ?? ''}
          loading="lazy"
          class="thumb"
        />
      </button>
    {/each}
  </div>
{/if}

{#if openIndex !== null}
  {@const photo = visible[openIndex]}
  <div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Photo viewer"
    onclick={close}
  >
    <div class="overlay-inner" onclick={(e) => e.stopPropagation()}>
      <button class="close-btn" onclick={close} aria-label="Close">&#215;</button>

      {#if openIndex > 0}
        <button class="arrow arrow-left" onclick={prev} aria-label="Previous">&#8249;</button>
      {/if}

      <img
        src="{directusUrl}/assets/{photo.directus_file_id}?width=1200&quality=90"
        alt={photo.caption ?? ''}
        class="full-img"
      />

      {#if openIndex < visible.length - 1}
        <button class="arrow arrow-right" onclick={next} aria-label="Next">&#8250;</button>
      {/if}

      {#if photo.caption}
        <p class="caption">{photo.caption}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .gallery { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 1rem; }
  .thumb-btn { padding: 0; border: none; background: none; cursor: pointer; }
  .thumb { width: 100px; height: 75px; object-fit: cover; display: block; border: 1px solid var(--border); }
  .thumb:hover { opacity: 0.85; }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.92);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .overlay-inner { position: relative; max-width: 90vw; max-height: 90vh; }
  .full-img { max-width: 90vw; max-height: 85vh; object-fit: contain; display: block; }
  .close-btn {
    position: absolute; top: -2rem; right: 0;
    background: none; border: none; color: #fff; font-size: 1.5rem;
    cursor: pointer; line-height: 1;
  }
  .arrow {
    position: absolute; top: 50%; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); border: none; color: #fff;
    font-size: 2rem; cursor: pointer; padding: 0.5rem 0.75rem; line-height: 1;
    border-radius: 4px;
  }
  .arrow-left { left: -3.5rem; }
  .arrow-right { right: -3.5rem; }
  .caption { color: #999; font-size: 0.85rem; text-align: center; margin-top: 0.5rem; }
</style>
```

- [ ] **Step 2: Replace photo grid in `frontend/src/routes/run/[id]/+page.svelte`**

Add import:
```svelte
  import Lightbox from '$lib/components/Lightbox.svelte';
```

Replace the existing `.photos` section:
```svelte
      <Lightbox {photos} directusUrl={DIRECTUS_URL} />
```

Remove the old `{#if photos.length > 0}` block with the individual `<img>` tags.

- [ ] **Step 3: Build**

```bash
cd frontend && npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/martin/dev/halfTheMarathon
git add frontend/src/lib/components/Lightbox.svelte \
  frontend/src/routes/run/[id]/+page.svelte
git commit -m "feat(frontend): photo lightbox on detail pages — full-screen overlay, prev/next, ESC to close"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Backfill script (Task 1)
- ✅ Structured logging (Task 2)
- ✅ Webhook retry queue (Task 3)
- ✅ Telegram alerting (Task 4)
- ✅ adapter-node migration (Task 5)
- ✅ Health dashboard at `/health` (Task 6)
- ✅ Interactive Leaflet map on detail page (Task 7)
- ✅ Elevation profile (Task 8)
- ✅ Grid filters — year + distance (Task 9)
- ✅ Calendar heatmap (Task 10)
- ✅ Year-in-review pages (Task 11)
- ✅ Stats calculations — streaks, PBs, milestones (Task 12)
- ✅ Expanded stats dashboard — YoY, pace trends, PBs, milestones, streaks (Task 13)
- ✅ Photo thumbnails on grid cards (Task 14)
- ✅ Lightbox (Task 15)

**Type consistency:**
- `Activity` interface in `directus.ts` gains `type`, `sport_type`, `best_efforts`, `photos` fields across Tasks 9, 13, 14 — applied in the order listed.
- `calculatePersonalBests` consumes `{ id, date, best_efforts }` — same shape as `Activity`.
- `CalendarHeatmap` receives `Record<string, { total_km, first_activity_id }>` — matches `+page.server.ts` output.
- `BarChart` and `LineChart` accept the same `datasets: Array<{ label, data, color }>` shape.
- `Lightbox` receives `Photo[]` with `{ id, directus_file_id, caption }` — subset of the existing `Photo` interface in `directus.ts`.
