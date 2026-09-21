import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { parseCardioActivities, parsePhotos } from './parse.js';
import { resolveGpxPath } from './gpx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DATA_ROOT = process.env.DATA_ROOT ?? path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(DATA_ROOT, 'recovered');

const activities = parseCardioActivities(path.join(RECOVERED_DIR, 'cardioActivities.csv'));
const photos = parsePhotos(path.join(RECOVERED_DIR, 'photos.csv'));

let gpxFound = 0;
let gpxMissing = 0;
const noGpx: string[] = [];

for (const act of activities) {
  if (!act.gpxFile) {
    noGpx.push(act.activityId);
    gpxMissing++;
  } else {
    const resolved = resolveGpxPath(act.gpxFile);
    if (resolved) gpxFound++;
    else gpxMissing++;
  }
}

let photosMatched = 0;
let photosOrphaned = 0;
let photosFileMissing = 0;
for (const [activityId, photoList] of photos) {
  const actExists = activities.some((a) => a.activityId === activityId);
  for (const p of photoList) {
    const filePath = path.join(RECOVERED_DIR, p.imageFileName);
    if (fs.existsSync(filePath)) {
      photosMatched++;
    } else {
      photosFileMissing++;
    }
    if (!actExists) photosOrphaned++;
  }
}

console.log('=== Data Validation ===');
console.log(`Activities total:       ${activities.length}`);
console.log(`  GPX found on disk:    ${gpxFound}`);
console.log(`  No GPX (manual):      ${noGpx.length}`);
console.log(`  GPX referenced but missing: ${gpxMissing - noGpx.length}`);
console.log('');
console.log(`Photo records total:    ${[...photos.values()].reduce((a, b) => a + b.length, 0)}`);
console.log(`  Files present:        ${photosMatched}`);
console.log(`  Files missing:        ${photosFileMissing}`);
console.log(`  No matching activity: ${photosOrphaned}`);
console.log('');
console.log(`Activities with photos: ${photos.size}`);
const multiPhoto = [...photos.entries()].filter(([, v]) => v.length > 1);
console.log(`Activities with 2+ photos: ${multiPhoto.length}`);
