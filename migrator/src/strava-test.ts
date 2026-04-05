import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { refreshToken, getAthlete } from './strava.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const token = await refreshToken();

const expiresAt = new Date(token.expires_at * 1000);
console.log('Token refreshed successfully');
console.log(`  access_token: ${token.access_token.slice(0, 8)}...`);
console.log(`  expires_at:   ${expiresAt.toLocaleString()}`);
console.log(`  refresh_token changed: ${token.refresh_token !== process.env.STRAVA_UPDATE_TOKEN}`);

const athlete = await getAthlete(token.access_token) as {
  id: number;
  firstname: string;
  lastname: string;
  city: string;
  country: string;
  sex: string;
};

console.log('\nAthlete:');
console.log(`  ID:      ${athlete.id}`);
console.log(`  Name:    ${athlete.firstname} ${athlete.lastname}`);
console.log(`  City:    ${athlete.city}, ${athlete.country}`);
console.log(`  Sex:     ${athlete.sex}`);
console.log('\nStrava API connection: OK');
