import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCardioActivities, parsePhotos } from './parse.js';
import { upsertActivity, upsertPhoto } from './directus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const RECOVERED_DIR = path.join(ROOT, 'recovered');

async function main() {
  const csvPath = path.join(RECOVERED_DIR, 'cardioActivities.csv');
  const photosPath = path.join(RECOVERED_DIR, 'photos.csv');

  console.log('Parsing activities...');
  const activities = parseCardioActivities(csvPath);
  const photosByActivity = parsePhotos(photosPath);

  console.log(`Upserting ${activities.length} activities...`);
  let done = 0;
  let errors = 0;
  let photoErrors = 0;

  for (const activity of activities) {
    try {
      const directusId = await upsertActivity(activity, null);
      const actPhotos = photosByActivity.get(activity.activityId) ?? [];
      for (const photo of actPhotos) {
        try {
          await upsertPhoto(directusId, photo, RECOVERED_DIR);
        } catch (err) {
          photoErrors++;
          console.error(`Photo upload failed for ${photo.imageFileName}:`, err);
        }
      }
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${activities.length}`);
    } catch (err) {
      errors++;
      console.error(`Failed to upsert activity ${activity.activityId}:`, err);
    }
  }

  console.log(`Done. ${done} upserted, ${errors} errors, ${photoErrors} photo errors.`);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
