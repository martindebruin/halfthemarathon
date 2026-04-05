# GPX Polyline Backfill Design

**Goal:** Patch all Runkeeper activities in Directus with `summary_polyline`, `start_lat`, and `start_lng` derived from their GPX files, so the RunMap component renders routes on the detail page.

**Architecture:** A standalone one-shot migrator script reads the Runkeeper CSV to build a `runkeeperActivityId → gpxFilename` map, queries Directus for Runkeeper activities missing a polyline, parses each GPX file to extract trackpoints, encodes them as a Google Polyline, and PATCHes the activity. No frontend changes needed — `RunMap` already handles the format.

**Tech Stack:** Node.js/TypeScript (tsx), `@mapbox/polyline` for encoding, regex-based GPX trackpoint extraction, Directus REST API.

---

## Scope

- Parse GPX trackpoints from `recovered/` and `routes/` directories
- Encode as Google Encoded Polyline (same format as Strava)
- PATCH `summary_polyline`, `start_lat`, `start_lng` on ~784 Runkeeper activities
- Cap trackpoints at 500 per run (subsample if longer) to keep encoded size manageable
- Activities with no GPX file (~18) are silently skipped
- Elevation data is out of scope (backlog)

## Files

- Modify: `migrator/src/gpx.ts` — add `parseGpxToPolyline(filePath)`
- Create: `migrator/src/patch-polylines.ts` — standalone patch script
- Modify: `migrator/package.json` — add `@mapbox/polyline` + `@types/mapbox__polyline`
