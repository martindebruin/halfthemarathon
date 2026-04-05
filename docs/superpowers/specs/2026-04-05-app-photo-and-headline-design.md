# Design Spec: App Photo Upload + Dynamic Run Headlines

**Date:** 2026-04-05  
**Status:** Approved

---

## Overview

Two features for the HTMITUB Android app:

1. **Photo upload** — tap a synced run in the list to attach a photo (gallery or camera), uploaded to Directus and rendered on the website automatically
2. **Dynamic headlines** — when an app run is uploaded, the server generates a short Swedish title using reverse geocoding, a Swedish holiday/time-of-day lookup, and Mistral Small on frmwrk-ai

---

## Feature 1: Photo Upload

### Android

- **Tap target:** each run row in `MainActivity` gets a click listener. Only synced runs (syncStatus = `"synced"`) respond to taps. Pending/failed runs do nothing.
- **Bottom sheet:** tapping a synced run shows a `ModalBottomSheetDialog` with two options:
  - "Välj från galleri" — `ActivityResultContracts.GetContent("image/*")`
  - "Ta foto" — `ActivityResultContracts.TakePicture` (writes to a temp URI via `FileProvider`)
- **Compression:** before upload, resize to max 1200px on the long edge and encode as JPEG at quality 80 using `android.graphics.Bitmap`. Keeps uploads under ~300 KB.
- **Upload:** `POST /api/run/{app_run_id}/photo` as `multipart/form-data`, single field `photo`, same bearer token auth as run upload.
- **UI feedback:** show a spinner on the run row during upload. On success, show a small thumbnail (the Directus asset URL). On failure, show a brief toast and allow retry by tapping again.
- **Run ID:** the `app_run_id` (UUID stored in local Room DB) is used as the path parameter — the server looks up the activity by `runkeeper_id = "app:{app_run_id}"`.

### Server (webhook-listener)

- **New route:** `POST /api/run/:id/photo` registered in `src/routes/run.ts`
- **Auth:** same `APP_BEARER_TOKEN` bearer check as the run endpoint
- **Multipart parsing:** use `multer` (in-memory storage, max 10 MB) to receive the file
- **Directus file upload:** POST to `/files` endpoint as `multipart/form-data` (same approach as `syncStravaPhotos` in `directus.ts`)
- **Activity lookup:** fetch activity by `runkeeper_id = "app:{id}"` to get the Directus activity UUID
- **Photo record:** create a record in the `photos` collection with `activity` FK and the file UUID — identical schema to Strava photos
- **Response:** `{ "asset_url": "https://cms-run.martindebruin.se/assets/{uuid}?width=240&height=144&fit=cover&quality=70" }` — returned to the Android app so it can display the thumbnail immediately without a separate fetch
- **Error handling:** 404 if activity not found, 400 if no file attached, 500 on Directus failure

### Frontend

No changes needed. The `photos` collection already feeds the run detail page and grid thumbnails.

---

## Feature 2: Dynamic Run Headlines

### Trigger

Called synchronously inside `upsertAppRun` after the activity is saved to Directus. Result stored in the `name` field via a PATCH to the activity. If headline generation fails for any reason, the run is still saved — the name field is left as `null` (editable in Directus).

### Steps

**1. Reverse geocode**  
`GET https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lng}&format=json&accept-language=sv`  
Extract `address.city` → `address.town` → `address.municipality` (first non-null). If `start_lat`/`start_lng` are null, skip and use no place name.

**2. Swedish holiday / day name**  
Hardcoded lookup for the run date (UTC+1/UTC+2 local time):
- Fixed holidays: Nyårsdagen (Jan 1), Trettondedag jul (Jan 6), Valborg (Apr 30), Nationaldagen (Jun 6), Julafton (Dec 24), Juldagen (Dec 25), Annandag jul (Dec 26), Nyårsafton (Dec 31)
- Variable: Easter Sunday computed via Anonymous Gregorian algorithm; Good Friday = Easter−2, Holy Saturday = Easter−1, Easter Monday = Easter+1, Ascension = Easter+39, Whit Sunday = Easter+49
- Midsommarafton = Friday between Jun 19–25; Midsommardagen = Saturday between Jun 20–26
- Alla helgons dag = Saturday between Oct 31–Nov 6
- Fallback: Swedish weekday name (Måndag … Söndag)

**3. Time of day**  
Bucket by local hour:
- 05:00–09:59 → "på morgonen"
- 10:00–11:29 → "på förmiddagen"
- 11:30–13:30 → "vid lunch"
- 13:31–16:59 → "på eftermiddagen"
- 17:00–20:59 → "på kvällen"
- 21:00–04:59 → "på natten"

**4. LLM call**  
Endpoint: `http://100.98.25.111:8080/v1/chat/completions` (Tailscale, OpenAI-compatible)  
Model: `mistral-small:24b`  
Timeout: 8 seconds  
System prompt:
```
Du är en assistent som genererar korta, naturliga svenska titlar för löprundor. Svara ENBART med titeln, inget annat. Titeln ska vara 4–7 ord, casual och beskrivande.
```
User message:
```
Plats: {place}. Tid: {timeOfDay}. Dag: {holidayOrWeekday}. Ge mig en löpartitel.
```
If place is unknown, omit that line.

**5. Fallback**  
If LLM times out or errors: construct `"{Weekday/holiday}löpning[ i {place}] {timeOfDay}"` — e.g. `"Söndagslöpning i Strängnäs på morgonen"`.

### New file

`webhook-listener/src/headline.ts` — exports:
- `getPlaceName(lat, lon): Promise<string | null>`
- `getSwedishDayLabel(date: Date): string` (holiday or weekday)
- `getTimeOfDayLabel(date: Date): string`
- `generateHeadline(place, day, time): Promise<string>` (LLM + fallback)

All four are pure/testable in isolation.

---

## Files Changed

| File | Change |
|---|---|
| `webhook-listener/src/routes/run.ts` | Add `POST /:id/photo` route |
| `webhook-listener/src/directus.ts` | Add `uploadPhotoForAppRun()` function |
| `webhook-listener/src/headline.ts` | New — all headline logic |
| `webhook-listener/src/index.ts` | Add `multer` middleware |
| `webhook-listener/package.json` | Add `multer` + `@types/multer` |
| `android/app/.../MainActivity.kt` | Add tap listener + bottom sheet |
| `android/app/.../ApiClient.kt` | Add `uploadPhoto()` method |
| `android/app/src/main/AndroidManifest.xml` | Add `FileProvider` + CAMERA permission |
| `android/app/src/main/res/xml/file_paths.xml` | New — FileProvider paths |

---

## Out of Scope

- Regenerating headlines from the app (edit in Directus)
- Multiple photos per run (first photo wins; Strava already handles multi-photo)
- Photo captions
- Offline headline generation
