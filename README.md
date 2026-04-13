# Half the Marathon I Used to Be

Personal running analytics app — GPS runs recorded on Android, synced and displayed on a self-hosted web app.

## What it does

- Run grid with photos, maps, and splits for every activity
- Year summary pages and lifetime stats
- Route clustering with personal bests per route and top-5 leaderboard on each run page
- Automatic route matching on ingest — new runs are matched to known routes via polyline Hausdorff similarity
- Calendar heatmap and pace trend charts
- Android app for GPS recording with background sync, photo attachment, and auto-generated Swedish run titles

## Architecture

| Service | Purpose | Port |
|---|---|---|
| `frontend/` | SvelteKit SSR web app | 3000 |
| `webhook-listener/` | Express server handling app run uploads | 3001 |
| Directus 11 | Headless CMS / data store (SQLite) | 8055 |

All services run via Docker Compose behind a reverse proxy. Directus uses SQLite.

## Stack

- **Frontend:** SvelteKit 2 + Svelte 5 (runes), TypeScript, Leaflet, Chart.js, `@directus/sdk`
- **Backend:** Express 4 + TypeScript, Directus 11
- **Infra:** Docker Compose, Nginx Proxy Manager
- **Android:** Kotlin, Room, WorkManager, OkHttp, Coil

## Development

### Prerequisites

- Node.js 20+
- Docker + Docker Compose

### Setup

```bash
cp .env.example .env
# fill in secrets — see .env.example for required variables

docker compose up -d
```

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps   # --legacy-peer-deps required
npm run dev
npm run check   # type check
npm run test    # unit tests
```

### Webhook listener

```bash
cd webhook-listener
npm install
npm run dev    # hot reload via tsx watch
npm run test
```

## Deployment

Manual rsync + Docker Compose rebuild. No CI/CD.

```bash
# Example: deploy frontend
rsync -avz frontend/src/ <host>:/path/to/halfthemarathon/frontend/src/
ssh <host> "cd /path/to/halfthemarathon && docker compose up --build -d frontend"
```

`VITE_DIRECTUS_PUBLIC_URL` is baked into the frontend bundle at build time via Docker build arg.

## Admin access

Route names on the stats page are editable when logged in as admin. Visit `/admin/login` and enter the `ADMIN_TOKEN` from your `.env`. Session cookie lasts 30 days.

## Android app

Source at `android/`. Features: GPS recording, pause/resume, background sync to `webhook-run.<domain>/api/run`, photo upload, auto-generated Swedish run titles via reverse geocoding + local LLM.

## Environment variables

See `.env.example` for all required variables. Key ones:

| Variable | Purpose |
|---|---|
| `DIRECTUS_TOKEN` | Static API token used by all services |
| `APP_BEARER_TOKEN` | Auth token for Android app |
| `ADMIN_TOKEN` | Admin session token for frontend route renaming |
| `TELEGRAM_BOT_TOKEN/CHAT_ID` | Error alerts |
