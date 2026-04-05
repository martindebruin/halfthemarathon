# Half the Marathon — Improvements Design
**Date:** 2026-04-02

## Overview

This spec covers stability hardening and feature additions for the halfthemarathoniusedtobe running blog. The project has 802 historical activities migrated from Runkeeper → Strava, stored in Directus, served by a SvelteKit frontend. Work is divided into stability (prerequisite) and features (built on top).

---

## Architecture Change: adapter-static → adapter-node

The frontend switches from SvelteKit's `adapter-static` (build-time HTML) to `adapter-node` (live Node.js server). This ensures new activities show up immediately after the webhook-listener syncs them to Directus — no rebuild required.

**Changes:**
- Replace `@sveltejs/adapter-static` with `@sveltejs/adapter-node` in `frontend/`
- Remove nginx container from `docker-compose.yml`; SvelteKit Node server runs on port 3000 behind the existing reverse proxy
- All `load()` functions already fetch from Directus — no data fetching logic changes needed
- Leaflet maps loaded via dynamic import (client-side only) to avoid SSR issues with browser APIs

---

## Phase 1 — Stability

Done in order. Each item unblocks the next.

### 1. Backfill Script

**File:** `migrator/src/backfill.ts`, invoked via `npm run backfill`

Reads local data (no Strava API calls):
- `recovered/cardioActivities.csv` — original Runkeeper activity rows
- `recovered/photos.csv` — photo metadata with lat/lng
- `migrator/state/progress.json` — maps Runkeeper activity IDs to assigned Strava IDs

Upserts all 802 activities and 712 photos into Directus using the existing `directus.ts` client. Idempotent — safe to re-run. Prerequisite for all frontend features.

### 2. Structured Logging

**Scope:** `webhook-listener` only

Replace ad-hoc `console.log` calls with a thin logger module (`src/logger.ts`). Outputs JSON lines to stdout:

```json
{"timestamp":"2026-04-02T10:00:00Z","level":"info","event":"webhook_received","activity_id":12345}
{"timestamp":"2026-04-02T10:00:01Z","level":"error","event":"directus_upsert_failed","activity_id":12345,"error":"timeout"}
```

Fields: `timestamp` (ISO), `level` (info/warn/error), `event` (snake_case string), optional `activity_id`, optional `error` (message string). No library — plain `JSON.stringify` to stdout. Docker captures it.

### 3. Webhook Retry Queue

**File:** `webhook-listener/queue.db` (SQLite, gitignored)

Schema:
```sql
CREATE TABLE pending_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strava_event TEXT NOT NULL,       -- raw JSON from Strava
  status TEXT DEFAULT 'pending',    -- pending | processing | failed | done
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

**Flow:**
1. Strava POST arrives → write to `pending_events` (status=pending) → respond 200 immediately
2. Background worker (setInterval, every 10s) picks up pending/failed rows with `attempts < 3`
3. On success → status=done
4. On failure → status=failed, attempts++, last_error set
5. After 3 failures → stays as failed, Telegram alert sent (see below)

Backoff: attempt 1 immediately, attempt 2 after 60s, attempt 3 after 300s (checked by the worker via `updated_at`).

### 4. Error Alerting (Telegram)

**File:** `webhook-listener/src/notify.ts`

Sends a Telegram message via Bot API on:
- Webhook event fails all 3 retries
- Directus unreachable at startup
- Unhandled exception (process `uncaughtException` handler)

Env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

Message format: plain text with event type, activity ID if known, error message, timestamp.

### 5. Health Dashboard

**Route:** `/health` in the SvelteKit frontend (server-side `load()`)

Displays:
- Directus status: pings `DIRECTUS_INTERNAL_URL/server/health`
- Webhook-listener status: pings `http://webhook-listener:3001/health`
- Activity count and photo count (Directus query)
- Last activity synced (most recent `date` in activities table)

No authentication — intended for internal use behind the reverse proxy. Simple table layout, auto-refreshes every 30s via `<meta http-equiv="refresh">`.

---

## Phase 2 — Features

### Frontend: adapter-node migration

Must be done before any feature work. See Architecture section above.

### Maps (Leaflet + OpenStreetMap)

**Interactive map on run detail page** (`/run/[id]`):
- Replace static SVG with a Leaflet map component (`src/lib/components/RunMap.svelte`)
- Loaded via `{#await import(...)}` to keep SSR clean
- Polyline decoded from `summary_polyline` using `@mapbox/polyline` (already a dependency)
- Start marker (green), finish marker (red)
- OSM tiles: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`

**Elevation profile on run detail page:**
- SVG chart rendered server-side from `splits_metric` array stored in Directus
- Each split provides distance and elevation; chart plots altitude vs distance
- Hover highlight via vanilla JS `mousemove` on the SVG
- Falls back gracefully if `splits_metric` is null/empty

### Browse & Discover

**Filters on home page grid:**
- Filter chips/dropdowns above the grid: Year (all years from data), Distance (any / 0–5km / 5–10km / 10–21km / 21km+), Type (Run / Trail / Race)
- Client-side filtering over the full activity list loaded once in the page `load()`
- URL query params updated on filter change (e.g. `/?year=2022&dist=10-21`) for shareable links
- Svelte reactive stores handle filter state

**Calendar heatmap on `/stats`:**
- GitHub-style grid: 52 columns × 7 rows, one cell per day
- Cell colour intensity based on km run that day (0 = grey, scale to max day)
- Click a cell → navigate to that run's detail page; if multiple runs on the same day, navigate to the first by start time; km shown is the day total across all runs
- Rendered as an SVG or CSS grid, no library needed

**Year-in-review pages at `/[year]`:**
- Dynamic SvelteKit route `src/routes/[year]/+page.server.ts`
- Validates `year` param (must match a year present in data, else 404)
- Shows: total distance, total runs, total elevation, longest run, fastest pace run, all runs that year in the standard grid
- Navigation: prev/next year links

### Stats & Insights (expanded `/stats`)

Existing weekly stats page rebuilt into a full stats dashboard. Sections:

**Lifetime milestones:**
- Total km, total hours, total elevation — computed in `load()` from all activities
- Fun equivalents (e.g. "X× the length of Sweden", "Y× the height of Everest") — constants defined in `src/lib/stats.ts`

**Running streaks:**
- Calculated from sorted activity dates: longest ever streak, current streak
- A streak is consecutive calendar days with at least one activity

**Year-over-year:**
- Bar chart (Chart.js) — one group per year, bars for total distance, total runs, total elevation
- Chart.js loaded client-side only

**Pace trends:**
- Line chart (Chart.js) — average pace per month across all years
- Separate series per year, or combined with year as colour

**Personal bests:**
- Calculated dynamically in `load()` — fetches all activities, iterates `best_efforts` JSON field on each
- Finds minimum `elapsed_time` per standard distance: 400m, 1km, 1 mile, 5km, 10km, half marathon, marathon
- Displayed as a table with distance, time, pace, date, and link to that run
- Always reflects true all-time best from full history; never stored as a cached value

### Photos

**Thumbnail on grid cards:**
- If activity has a hero photo, fetch its Directus URL and use as card background image
- Falls back to SVG route minimap if no photo
- `getAllActivities()` query extended with a nested Directus relation to include one photo URL per activity — single API call, no N+1

**Lightbox on detail pages:**
- Vanilla JS, no library
- Photo grid on detail page; click any photo → full-screen overlay
- Overlay: dark background, centred image, prev/next arrows, ESC to close
- Implemented as a Svelte component (`src/lib/components/Lightbox.svelte`) with simple show/hide state

---

## Data & API Notes

- All data fetched via `@directus/sdk` from `DIRECTUS_INTERNAL_URL` (server-side) or `DIRECTUS_PUBLIC_URL` (client-side, only for Lightbox image src)
- No new Directus collections needed — all features use existing `activities` and `photos` tables
- `best_efforts`, `splits_metric`, `laps` are JSON fields already stored on `activities`; no schema changes required
- Leaflet and Chart.js are client-side only — import via `browser` guard or dynamic import

## Environment Variables (additions)

```
TELEGRAM_BOT_TOKEN=   # Telegram bot token for alerting
TELEGRAM_CHAT_ID=     # Chat ID to send alerts to
```

Add to `.env.example`.

---

## Out of Scope

- Social sharing / OG images
- Global route heatmap
- Photo map pins
- Standalone photo gallery page
- SQLite backups
- Text search
- Pagination / infinite scroll
