import type { StravaTokenResponse, StravaUploadResponse, StravaActivity, UploadPollResult } from './types.js';
import fs from 'fs';
import https from 'https';
import FormData from 'form-data';

const BASE_URL = 'https://www.strava.com/api/v3';

export async function refreshToken(): Promise<StravaTokenResponse> {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: process.env.STRAVA_UPDATE_TOKEN,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<StravaTokenResponse>;
}

export async function getAthlete(accessToken: string): Promise<object> {
  const res = await fetch(`${BASE_URL}/athlete`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /athlete failed ${res.status}`);
  return res.json() as Promise<object>;
}

export function uploadActivity(
  accessToken: string,
  gpxPath: string,
  name: string,
  externalId: string
): Promise<StravaUploadResponse | null> {
  // Returns null when Strava returns 409 (duplicate external_id).
  // Native fetch doesn't properly stream form-data — use https.request directly.
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', fs.createReadStream(gpxPath));
    form.append('data_type', 'gpx');
    form.append('name', name || 'Run');
    form.append('external_id', externalId);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      ...form.getHeaders(),
    };

    const req = https.request(
      { hostname: 'www.strava.com', path: '/api/v3/uploads', method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode === 409) {
            return resolve(null); // duplicate external_id — caller handles lookup
          }
          if (!res.statusCode || res.statusCode >= 300) {
            return reject(new Error(`POST /uploads failed ${res.statusCode}: ${body.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(body) as StravaUploadResponse);
          } catch {
            reject(new Error(`Upload response not JSON: ${body.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    form.pipe(req);
  });
}

export async function pollUpload(
  accessToken: string,
  uploadId: number
): Promise<UploadPollResult> {
  const maxAttempts = 15;
  let delay = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(delay);
    const res = await fetch(`${BASE_URL}/uploads/${uploadId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`GET /uploads/${uploadId} failed ${res.status}`);

    const text = await res.text();
    let data: StravaUploadResponse;
    try {
      data = JSON.parse(text) as StravaUploadResponse;
    } catch {
      // Strava occasionally returns non-JSON (e.g. "500 Internal Server Error") even on 200
      throw new Error(`Poll response not JSON: ${text.slice(0, 100)}`);
    }
    if (data.error) {
      // Strava embeds the existing activity ID in the error HTML for duplicates
      // e.g. "duplicate of <a href='/activities/12345'>..."
      const dupMatch = data.error.match(/\/activities\/(\d+)/);
      if (dupMatch) {
        return { activity_id: 0, duplicate_of: parseInt(dupMatch[1], 10) };
      }
      throw new Error(`Upload error: ${data.error}`);
    }
    if (data.activity_id) return { activity_id: data.activity_id };
    if (data.status === 'Your activity is ready.' && data.activity_id) {
      return { activity_id: data.activity_id };
    }

    delay = Math.min(delay * 1.5, 10000);
  }
  throw new Error(`Upload polling timed out after ${maxAttempts} attempts`);
}

export async function createManualActivity(
  accessToken: string,
  params: {
    name: string;
    startDateLocal: string;
    elapsedTime: number;
    distance: number;
    description?: string;
  }
): Promise<StravaActivity> {
  const res = await fetch(`${BASE_URL}/activities`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: params.name,
      type: 'Run',
      sport_type: 'Run',
      start_date_local: params.startDateLocal,
      elapsed_time: params.elapsedTime,
      distance: params.distance,
      description: params.description ?? '',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /activities failed ${res.status}: ${body}`);
  }
  return res.json() as Promise<StravaActivity>;
}

export async function getActivity(
  accessToken: string,
  activityId: number
): Promise<StravaActivity> {
  const res = await fetch(`${BASE_URL}/activities/${activityId}?include_all_efforts=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET /activities/${activityId} failed ${res.status}`);
  return res.json() as Promise<StravaActivity>;
}

export async function findActivityByDate(
  accessToken: string,
  date: Date
): Promise<StravaActivity | null> {
  const before = Math.floor(date.getTime() / 1000) + 3600;
  const after = Math.floor(date.getTime() / 1000) - 3600;
  const res = await fetch(
    `${BASE_URL}/athlete/activities?before=${before}&after=${after}&per_page=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`GET /athlete/activities failed ${res.status}`);
  const activities = await res.json() as StravaActivity[];
  return activities[0] ?? null;
}

export class DuplicateActivityError extends Error {
  constructor(message: string, public readonly activityId: number | null) {
    super(message);
    this.name = 'DuplicateActivityError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
