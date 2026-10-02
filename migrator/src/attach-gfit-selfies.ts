import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE = process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_TOKEN ?? '';
const PHOTOS_DIR = '/tmp/htm-selfies';

// tcx activity Id (from <Id> tag) -> selfie filename
const MATCHES: Record<string, string> = {
  '2026-04-07T15:10:54.697Z': 'PXL_20260407_154818658.MP.jpg',
  '2026-04-12T08:31:35.973Z': 'PXL_20260412_094847668.jpg',
  '2026-04-30T14:06:33.609Z': 'PXL_20260430_151714626.jpg',
  '2026-05-01T09:46:45.786Z': 'PXL_20260501_104204358.jpg',
  '2026-05-17T09:14:15.119Z': 'PXL_20260517_100756683.jpg',
  '2026-05-19T15:19:31.255Z': 'PXL_20260519_162719575.MP.jpg',
};

async function directusFetch(reqPath: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${reqPath}`, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${reqPath} -> ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  let ok = 0, fail = 0;
  for (const [tcxId, filename] of Object.entries(MATCHES)) {
    try {
      const gfitId = `gfit_${tcxId}`;
      const found = await directusFetch(
        `/items/activities?filter[runkeeper_id][_eq]=${encodeURIComponent(gfitId)}&fields=id`,
        { headers: { 'Content-Type': 'application/json' } }
      );
      if (found.data.length === 0) {
        console.log(`  SKIP ${filename}: no activity found for ${gfitId}`);
        fail++;
        continue;
      }
      const activityId = found.data[0].id;

      const filePath = path.join(PHOTOS_DIR, filename);
      const fileBuffer = fs.readFileSync(filePath);
      const form = new globalThis.FormData();
      form.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }), filename);

      const uploadRes = await fetch(`${BASE}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: form,
      });
      if (!uploadRes.ok) throw new Error(`file upload failed ${uploadRes.status}: ${await uploadRes.text()}`);
      const fileData = (await uploadRes.json()) as { data: { id: string } };

      await directusFetch('/items/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_id: activityId,
          directus_file_id: fileData.data.id,
          original_filename: filename,
        }),
      });

      console.log(`  OK ${filename} -> activity ${activityId}`);
      ok++;
    } catch (err) {
      console.error(`  FAIL ${filename}: ${err instanceof Error ? err.message : err}`);
      fail++;
    }
  }
  console.log(`\nDone. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
