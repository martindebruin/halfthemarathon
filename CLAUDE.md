# CLAUDE.md — halfTheMarathon (HTMITUB)

**Project:** HTMITUB ("Half the Marathon I Used to Be") — personal running analytics app. Runs are recorded via Android app, synced to Directus, and displayed in a SvelteKit web app.

---

## Services

| Directory | Purpose | Port |
|---|---|---|
| `frontend/` | SvelteKit SSR app (public website) | 3000 |
| `webhook-listener/` | Express server handling Strava webhooks + Android app run uploads | 3001 |
| `directus/` | Headless CMS (official image, not a directory) | 8055 |

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

### Full local stack
```bash
cp .env.example .env  # fill in secrets
docker compose up -d
# then: cd migrator && npm run setup-schema
```

---

## Deployment

Manual rsync + Docker Compose rebuild on the server. No CI/CD.

Typical deploy (frontend example):
```bash
rsync -avz --delete frontend/src/ <host>:/home/martin/dockers/halfthemarathon/frontend/src/
ssh <host> "cd /home/martin/dockers/halfthemarathon && docker compose up --build -d frontend"
```

The `VITE_DIRECTUS_PUBLIC_URL` is injected at build time as a Docker build ARG — changing it requires a rebuild.

### Android app sync
The Android app (`android/`) posts runs to `https://webhook-run.martindebruin.se/api/run` (separate subdomain from the main site), routed to the webhook-listener. Config in `android/local.properties` (gitignored).

DNS for all subdomains is managed via a Loopia DynDNS script at `~/scripts/loopiaDNS.py` on the server. Add new subdomains to `~/scripts/data/domains.txt` and re-run the script.

NPM (Nginx Proxy Manager) handles the reverse proxy. The webhook-listener proxy host must use the exact Docker container name as `forward_host` (e.g. `halfthemarathon-webhook-listener-1`).

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
- Handles Android app run uploads (`POST /api/run`) and photo uploads (`POST /api/run/:id/photo`)
- Telegram alert on uncaught exceptions

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
| `DIRECTUS_SECRET` | Directus | 32+ char session secret |
| `DIRECTUS_ADMIN_EMAIL` | Directus | |
| `DIRECTUS_ADMIN_PASSWORD` | Directus | |
| `DIRECTUS_PUBLIC_URL` | Directus, build | External Directus URL |
| `DIRECTUS_INTERNAL_URL` | frontend, webhook-listener | Defaults to `http://directus:8055` |
| `DIRECTUS_TOKEN` | webhook-listener, frontend | Static API token |
| `FRONTEND_URL` | Directus CORS | Frontend origin |
| `VITE_DIRECTUS_PUBLIC_URL` | frontend build | Baked into frontend bundle at build time |
| `TELEGRAM_BOT_TOKEN` | webhook-listener | Error alerts |
| `TELEGRAM_CHAT_ID` | webhook-listener | Error alerts |
| `APP_BEARER_TOKEN` | webhook-listener | Android app auth (static bearer token) |
| `ADMIN_TOKEN` | frontend | Admin cookie for route-renaming UI |

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
  index.ts               # Server bootstrap
  routes/run.ts          # Android app run upload handler (POST /api/run, POST /api/run/:id/photo)
  directus.ts            # upsertAppRun, uploadPhotoForAppRun, patchActivityName
  route-matcher.ts       # Hausdorff-based route matching on new run ingest
  headline.ts            # Auto-generated Swedish run titles (Nominatim + local LLM)
  notify.ts              # Telegram alerts
  logger.ts              # JSON structured logging
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
