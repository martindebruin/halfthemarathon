import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { refreshToken, uploadActivity } from './strava.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const tok = await refreshToken();
console.log('Token:', tok.access_token.slice(0, 10) + '...');

const gpxPath = path.resolve(__dirname, '../../routes/2025-08-17-112102.gpx');

try {
  const result = await uploadActivity(tok.access_token, gpxPath, 'Probe Test', 'probe_node_test_002');
  console.log('Upload result:', JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Upload failed:', err instanceof Error ? err.message : err);
}
