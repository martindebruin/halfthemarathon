# Android Run Recorder — Design

**Date:** 2026-04-04
**Status:** Approved

---

## Overview

A standalone native Android app (Kotlin) for recording runs, with local-first storage and automatic sync to the existing HTMITUB backend. Recorded activities appear in the web app alongside Strava and Runkeeper activities.

---

## System Architecture

```
[Android app]
  → records GPS track locally (SQLite)
  → on run end: encodes polyline, computes 1km splits
  → POST /api/run to webhook-listener (bearer token auth)
  → webhook-listener upserts to Directus → appears in HTMITUB

Offline: run saved locally, upload queued
Auto-retry: WorkManager monitors connectivity, retries queued uploads
Manual: "Upload" button per pending run on home screen
```

Each run is assigned a UUID on-device (`app_run_id`) used as an idempotency key — retries never produce duplicate activities. Activities are distinguished by `source = 'app'` in Directus.

---

## Android App

### Screens

**Home screen**
- List of recorded runs: date, distance, avg pace, sync status (`pending` / `synced` / `failed`)
- "Start run" button
- Each pending/failed row has a manual "Upload" button
- Auto-sync runs silently via WorkManager; manual button is the fallback only

**Recording screen**
- Three equal full-width rows: Distance · Current pace · Avg pace
- Equal-weight Pause and Stop buttons at the bottom
- Paused state: timer and distance freeze, GPS continues recording (unbroken track), current pace shows "—", Pause button becomes "Resume"
- Stop ends the run, triggers an upload attempt, returns to home screen

### Local SQLite Schema

**`runs`** — one row per completed run

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | UUID, PK |
| `started_at` | INTEGER | Unix ms |
| `distance_m` | REAL | meters |
| `moving_time_s` | INTEGER | excludes paused time |
| `elapsed_time_s` | INTEGER | wall-clock time |
| `avg_speed_ms` | REAL | m/s |
| `start_lat` | REAL | |
| `start_lng` | REAL | |
| `summary_polyline` | TEXT | Google Encoded Polyline |
| `splits_json` | TEXT | JSON array |
| `sync_status` | TEXT | `pending` / `synced` / `failed` |

**`track_points`** — raw GPS points, deleted by `SyncWorker` after receiving a 200 response

| Column | Type | Notes |
|---|---|---|
| `run_id` | TEXT | FK → runs.id |
| `lat` | REAL | |
| `lng` | REAL | |
| `alt` | REAL | meters |
| `ts` | INTEGER | Unix ms |
| `accuracy` | REAL | meters |

### GPS Recording Service

A foreground `Service` with a persistent notification (showing live distance) keeps GPS alive when the screen is off — required by Android 9+ for background location.

**GPS provider:** `FusedLocationProviderClient`, high-accuracy mode, 1-second interval, 5m minimum displacement. Points with accuracy > 10m are discarded.

**Pace calculation:**
- *Current pace*: rolling average over the last 30 seconds of GPS points (smooths GPS jitter)
- *Avg pace*: total distance ÷ total moving time

**1km splits:** computed as accumulated distance crosses each km boundary:
```json
[
  { "split": 1, "distance": 1000, "moving_time": 312, "average_speed": 3.21, "elevation_difference": 5 },
  { "split": 2, "distance": 1000, "moving_time": 308, "average_speed": 3.25, "elevation_difference": -3 }
]
```
This matches the existing `splits_metric` format from Strava — the frontend splits table renders these with no changes.

**Polyline:** track points encoded to Google Encoded Polyline on-device, matching the existing `summary_polyline` format. Altitude lives in `splits_metric`, not the polyline.

**Pause behaviour:** GPS points continue to be collected and stored during a pause (preserving an unbroken track) but are excluded from distance and time accumulation.

---

## Webhook-Listener Extension

### New file: `webhook-listener/src/routes/run.ts`

**Endpoint:** `POST /api/run`

**Auth:** `Authorization: Bearer <APP_BEARER_TOKEN>`. Returns 401 if missing or incorrect. `APP_BEARER_TOKEN` is a new entry in `.env`.

**Request payload:**
```json
{
  "app_run_id": "550e8400-e29b-41d4-a716-446655440000",
  "started_at": "2026-04-04T07:12:00Z",
  "distance_m": 8420,
  "moving_time_s": 2640,
  "elapsed_time_s": 2780,
  "avg_speed_ms": 3.19,
  "start_lat": 59.334,
  "start_lng": 18.063,
  "summary_polyline": "cg`|J...",
  "splits": [
    { "split": 1, "distance": 1000, "moving_time": 318, "average_speed": 3.14, "elevation_difference": 4 }
  ]
}
```

**Directus mapping:**

| Payload field | `activities` field | Notes |
|---|---|---|
| `app_run_id` | `runkeeper_id` | Stored as `app:{uuid}` for idempotency |
| `started_at` | `date` | |
| `distance_m` | `distance_m` | |
| `moving_time_s` | `moving_time_s` | |
| `elapsed_time_s` | `elapsed_time_s` | |
| `avg_speed_ms` | `average_speed` | |
| `start_lat` | `start_lat` | |
| `start_lng` | `start_lng` | |
| `summary_polyline` | `summary_polyline` | |
| `splits` | `splits_metric` | JSON.stringify'd |
| — | `source` | `'app'` |
| — | `type` | `'Run'` |

The endpoint upserts on `runkeeper_id = 'app:{app_run_id}'`. Safe to retry.

**Response:** `200 OK` on success (created or updated). `400` if required fields are missing. `401` if auth fails. `500` on Directus error.

### New env var

```
APP_BEARER_TOKEN=<random 32+ char string>
```

Added to `.env` and `.env.example`.

---

## File Map

| File | Change |
|---|---|
| `webhook-listener/src/routes/run.ts` | New — POST /api/run handler |
| `webhook-listener/src/index.ts` | Register new route |
| `.env.example` | Add `APP_BEARER_TOKEN` |
| `android/` | New top-level directory — Kotlin Android project |
| `android/app/src/main/java/.../MainActivity.kt` | Home screen |
| `android/app/src/main/java/.../RecordingActivity.kt` | Recording screen |
| `android/app/src/main/java/.../RecordingService.kt` | Foreground GPS service |
| `android/app/src/main/java/.../RunDatabase.kt` | Room database (runs + track_points) |
| `android/app/src/main/java/.../SyncWorker.kt` | WorkManager upload worker |
| `android/app/src/main/java/.../ApiClient.kt` | HTTP client for POST /api/run |
| `android/app/src/main/java/.../PolylineEncoder.kt` | Google Encoded Polyline encoder |

---

## Out of Scope

- Map display in the app
- Heart rate / cadence / other sensors
- iOS support
- Route matching (app runs will cluster into routes via the existing geo-clustering logic once uploaded)
- In-app run history beyond the pending-upload list
- Calories computation (can be backfilled by the existing `patch-calories` migrator)
