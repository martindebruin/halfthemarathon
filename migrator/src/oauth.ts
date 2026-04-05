/**
 * Strava OAuth re-authorization script.
 * Gets a new token with activity:write,activity:read_all scopes.
 *
 * Usage: npx tsx src/oauth.ts
 * Then open the printed URL in a browser and authorize.
 * The script catches the redirect automatically and writes new tokens to .env
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../.env');
dotenv.config({ path: ENV_PATH });

const CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;
const PORT = 9876;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const authUrl = `https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&approval_prompt=force&scope=activity:write,activity:read_all`;

console.log('\nOpen this URL in your browser to authorize:\n');
console.log(authUrl);
console.log('\nWaiting for callback on port', PORT, '...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`<h2>Authorization denied: ${error}</h2>`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end('<h2>No code received</h2>');
    return;
  }

  res.end('<h2>Authorization successful! You can close this tab.</h2>');

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      console.error('Token exchange failed:', await tokenRes.text());
      process.exit(1);
    }

    const token = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
      athlete: { firstname: string; lastname: string };
    };

    console.log(`Authorized as: ${token.athlete.firstname} ${token.athlete.lastname}`);
    console.log(`New access_token:  ${token.access_token.slice(0, 8)}...`);
    console.log(`New refresh_token: ${token.refresh_token.slice(0, 8)}...`);
    console.log(`Expires at: ${new Date(token.expires_at * 1000).toLocaleString()}`);

    // Update .env
    let env = fs.readFileSync(ENV_PATH, 'utf-8');
    env = env.replace(/^STRAVA_ACCESS_TOKEN=.*/m, `STRAVA_ACCESS_TOKEN=${token.access_token}`);
    env = env.replace(/^STRAVA_UPDATE_TOKEN=.*/m, `STRAVA_UPDATE_TOKEN=${token.refresh_token}`);
    fs.writeFileSync(ENV_PATH, env);
    console.log('\n.env updated with new tokens.');

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }

  server.close();
});

server.listen(PORT);
