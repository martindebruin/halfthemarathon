const BASE_URL = 'https://www.strava.com/api/v3';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

let cachedToken = {
  access_token: process.env.STRAVA_ACCESS_TOKEN ?? '',
  expires_at: 0,
};

export async function getAccessToken(): Promise<string> {
  if (Date.now() / 1000 < cachedToken.expires_at - 300) {
    return cachedToken.access_token;
  }

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

  if (!res.ok) throw new Error(`Token refresh failed ${res.status}`);
  const tok = await res.json() as TokenResponse;
  cachedToken = { access_token: tok.access_token, expires_at: tok.expires_at };
  return tok.access_token;
}

export async function fetchActivity(activityId: number): Promise<object> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/activities/${activityId}?include_all_efforts=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /activities/${activityId} failed ${res.status}`);
  return res.json() as Promise<object>;
}

export interface StravaPhoto {
  unique_id: string;
  urls: Record<string, string>;
}

export async function fetchActivityPhotos(activityId: number): Promise<StravaPhoto[]> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/activities/${activityId}/photos?size=1000`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /activities/${activityId}/photos failed ${res.status}`);
  return res.json() as Promise<StravaPhoto[]>;
}
