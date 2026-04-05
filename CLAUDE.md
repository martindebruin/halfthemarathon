# CLAUDE.md — halfTheMarathon (HTMITUB)

**Project:** HTMITUB ("Half the Marathon I Used to Be") — personal running analytics app aggregating 6+ years of Runkeeper + Strava data into a SvelteKit web app backed by Directus CMS.

---

## Services

| Directory | Purpose | Port |
|---|---|---|
| `frontend/` | SvelteKit SSR app (public website) | 3000 |
| `webhook-listener/` | Express server handling Strava webhook events | 3001 |
| `directus/` | Headless CMS (official image, not a directory) | 8055 |
| `migrator/` | One-shot migration scripts (Runkeeper → Strava → Directus) | — |

All services run in Docker Compose. Directus uses SQLite at `/directus/database/db.sqlite`. The reverse proxy network (`proxy`) is external — expects a pre-existing Traefik/nginx proxy.

---

## Development

### Frontend
```bash
cd frontend
npm install --legacy-peer-deps   # --legacy-peer-deps is required (see .npmrc)
npm run dev          # Vite dev server
npm run check        # svelte-check type check
npm run test         # vitest unit tests
npm run build        # SvelteKit production build
```

### Webhook listener
```bash
cd webhook-listener
npm install
npm run dev    # tsx watch (hot reload)
npm run build  # tsc → dist/
npm run test   # vitest unit tests
```

### Migrator (run once, or for backfill scripts)
```bash
cd migrator
npm install
npm run setup-schema    # Create Directus collections (idempotent)
npm run migrate         # Full migration (reads recovered/, routes/)
npm run migrate:dry     # Dry run
npm run patch-polylines # Backfill missing polylines from GPX files
npm run patch-calories  # Backfill zero-calorie activities (ACSM formula)
npm run test            # vitest unit tests
```

### Full local stack
```bash
cp .env.example .env  # fill in secrets
docker compose up -d
# then: cd migrator && npm run setup-schema
```

---

## Deployment

Manual rsync + Docker Compose rebuild on `dedibox1`. No CI/CD.

Typical deploy (frontend example):
```bash
rsync -avz --delete frontend/src/ dedibox1:/home/martin/dockers/halfthemarathon/frontend/src/
ssh dedibox1 "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d frontend"
```

The `VITE_DIRECTUS_PUBLIC_URL` is injected at build time as a Docker build ARG — changing it requires a rebuild.

---

## Tech Stack

### Frontend (`frontend/`)
- **SvelteKit 2 + Svelte 5 with Runes** — use `$props()`, `$state()`, `$derived()`, `$effect()`; do NOT use Svelte 4 syntax (`$:`, `export let`)
- **TypeScript 5**, `@sveltejs/adapter-node` (SSR, Node.js server)
- **`@directus/sdk` v18** — all data fetching is server-side in `+page.server.ts` files
- **Leaflet** — maps; must be dynamically imported inside `$effect()` (not `onMount`, which gets tree-shaken in production builds for runes components)
- **Chart.js** — stats page charts
- No CSS framework — scoped styles per component, dark theme only

### Webhook listener (`webhook-listener/`)
- **Express 4 + TypeScript**, compiled to `dist/` via `tsc`
- **better-sqlite3** — durable SQLite event queue at `data/queue.db`
- Queue retries: attempt 1 immediate, attempt 2 after 60s, attempt 3 after 300s; Telegram alert on failure

### Migrator (`migrator/`)
- **TypeScript via `tsx`** — no build step, run directly
- One-shot scripts; progress saved to `state/progress.json` (gitignored, delete to re-run from scratch)
- Strava rate limits enforced: 90 req/15 min, 900 req/day

---

## Data Model

### `activities` collection (key fields)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Directus PK |
| `strava_id` | bigInteger | unique, nullable |
| `runkeeper_id` | string | unique, nullable |
| `source` | string | `'runkeeper'`, `'strava'`, `'runkeeper+strava'` |
| `date` | timestamp | |
| `distance_m` | float | meters |
| `moving_time_s` | integer | seconds |
| `average_speed` | float | m/s — **null for Runkeeper-only activities** |
| `summary_polyline` | text | Google Encoded Polyline |
| `splits_metric` | json | Stored as **JSON string**, requires `JSON.parse()` |
| `best_efforts` | json | Stored as **JSON string**, requires `JSON.parse()` |
| `calories` | float | 0 for some Strava activities; use ACSM formula as fallback |

### `photos` collection
References Directus file UUIDs. Served via:
```
${DIRECTUS_URL}/assets/{uuid}?width=240&height=144&fit=cover&quality=70
```

---

## Key Patterns

### Pace for Runkeeper activities
Runkeeper activities have `average_speed = null`. Use the `computedSpeed` fallback:
```ts
import { computedSpeed } from '$lib/utils.js';
formatPace(activity.average_speed ?? computedSpeed(activity.distance_m, activity.moving_time_s))
```

### Maps in Svelte 5
Leaflet must be loaded inside `$effect()`, not `onMount` — `onMount` gets tree-shaken in production builds:
```svelte
let mapEl: HTMLDivElement | undefined = $state(undefined);
$effect(() => {
  if (!mapEl) return;
  let map: import('leaflet').Map | undefined;
  (async () => {
    const L = (await import('leaflet')).default;
    // ... map setup ...
  })();
  return () => map?.remove();
});
```

### Directus API access (migrator / webhook-listener)
All use the same `directusFetch()` helper pattern — throws on non-OK responses:
```ts
async function directusFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${getDirectusUrl()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Directus ${options.method ?? 'GET'} ${path} failed ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}
```

### Adding a new migrator script
Follow `migrator/src/patch-polylines.ts` as the pattern. Add a `"script-name": "tsx src/script.ts"` entry to `migrator/package.json`.

---

## Environment Variables

Single `.env` at repo root, loaded by Docker Compose and referenced by all services.

| Variable | Used By | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | migrator, webhook-listener | |
| `STRAVA_CLIENT_SECRET` | migrator, webhook-listener | |
| `STRAVA_ACCESS_TOKEN` | webhook-listener | Refreshed automatically |
| `STRAVA_UPDATE_TOKEN` | migrator, webhook-listener | OAuth refresh token |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | webhook-listener | Webhook handshake secret |
| `DIRECTUS_SECRET` | Directus | 32+ char session secret |
| `DIRECTUS_ADMIN_EMAIL` | Directus | |
| `DIRECTUS_ADMIN_PASSWORD` | Directus | |
| `DIRECTUS_PUBLIC_URL` | Directus, build | External Directus URL |
| `DIRECTUS_INTERNAL_URL` | frontend, webhook-listener | Defaults to `http://directus:8055` |
| `DIRECTUS_TOKEN` | all services | Static API token |
| `FRONTEND_URL` | Directus CORS | Frontend origin |
| `VITE_DIRECTUS_PUBLIC_URL` | frontend build | Baked into frontend bundle at build time |
| `TELEGRAM_BOT_TOKEN` | webhook-listener | Error alerts |
| `TELEGRAM_CHAT_ID` | webhook-listener | Error alerts |

---

## File Layout (key files)

```
frontend/src/
  lib/
    server/directus.ts   # All Directus queries (server-side only)
    utils.ts             # formatPace, formatDistance, computedSpeed, etc.
    stats.ts             # Streaks, PBs, milestone configs
    components/
      RunMap.svelte      # Leaflet map component
      CalendarHeatmap.svelte
  routes/
    +page.svelte         # Run list (home)
    run/[id]/+page.svelte  # Run detail
    [year]/+page.svelte  # Year summary
    stats/+page.svelte   # Stats dashboard
    health/+page.svelte  # Health check (auto-refreshes)

webhook-listener/src/
  index.ts               # Server bootstrap + background worker (10s poll)
  routes/webhook.ts      # Strava webhook handler
  queue.ts               # SQLite queue with retry
  directus.ts            # upsertStravaActivity, syncStravaPhotos
  strava.ts              # fetchActivity, fetchActivityPhotos
  notify.ts              # Telegram alerts

migrator/src/
  index.ts               # Main migration loop
  parse.ts               # CSV parsers (cardioActivities.csv, photos.csv)
  gpx.ts                 # GPX parsing → polyline (max 500 trackpoints)
  directus.ts            # upsertActivity, upsertPhoto
  strava.ts              # Strava upload + rate limiter
  setup-schema.ts        # Idempotent Directus schema setup
  patch-polylines.ts     # Backfill missing polylines
  patch-calories.ts      # Backfill zero-calorie activities
```

---

## Design / CSS

Dark theme only. CSS custom properties (set in `+layout.svelte`):

```css
--bg: #0f0f0f
--surface: #1a1a1a
--border: #2a2a2a
--text: #e8e8e8
--muted: #888
--accent: #f97316   /* orange */
```

Font: `system-ui, sans-serif`. No external CSS framework.
