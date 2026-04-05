/**
 * Applies the Directus schema for HTMITUB.
 * Run once before the first migration: npm run setup-schema
 * Safe to re-run — skips fields/collections that already exist.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BASE = process.env.DIRECTUS_INTERNAL_URL ?? process.env.DIRECTUS_PUBLIC_URL ?? 'http://localhost:8055';
const TOKEN = process.env.DIRECTUS_TOKEN ?? '';

if (!TOKEN) {
  console.error('DIRECTUS_TOKEN not set in .env');
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // 400 with "already exists" is expected when re-running
    if (res.status === 400 && text.includes('already')) return null;
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function createCollection(collection: string, meta: object): Promise<void> {
  console.log(`  Collection: ${collection}`);
  try {
    await api('POST', '/collections', {
      collection,
      meta: { icon: 'directions_run', ...meta },
      schema: {},
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already')) throw err;
    console.log(`    (already exists)`);
  }
}

async function createField(collection: string, field: object): Promise<void> {
  const name = (field as Record<string, unknown>)['field'] as string;
  try {
    await api('POST', `/fields/${collection}`, field);
    process.stdout.write('.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('already')) {
      process.stdout.write('_');
      return;
    }
    console.error(`\n  Field ${name} failed: ${msg}`);
  }
}

async function main(): Promise<void> {
  // Verify connection
  const health = await fetch(`${BASE}/server/health`);
  if (!health.ok) throw new Error(`Directus not reachable at ${BASE}`);
  console.log(`Connected to Directus at ${BASE}\n`);

  // ── activities ──────────────────────────────────────────────────────────
  await createCollection('activities', { note: 'Running activities from Runkeeper + Strava' });
  console.log('  Fields:');
  const activityFields = [
    { field: 'strava_id',            type: 'bigInteger', schema: { is_unique: true, is_nullable: true } },
    { field: 'runkeeper_id',         type: 'string',     schema: { is_unique: true, is_nullable: true, max_length: 64 } },
    { field: 'source',               type: 'string',     schema: { default_value: 'runkeeper', max_length: 20 } },
    { field: 'date',                 type: 'timestamp',  schema: { is_nullable: false } },
    { field: 'name',                 type: 'string',     schema: { is_nullable: true, max_length: 255 } },
    { field: 'route_name',           type: 'string',     schema: { is_nullable: true, max_length: 255 } },
    { field: 'type',                 type: 'string',     schema: { default_value: 'Run', max_length: 50 } },
    { field: 'sport_type',           type: 'string',     schema: { is_nullable: true, max_length: 50 } },
    { field: 'distance_m',           type: 'float',      schema: { is_nullable: true } },
    { field: 'moving_time_s',        type: 'integer',    schema: { is_nullable: true } },
    { field: 'elapsed_time_s',       type: 'integer',    schema: { is_nullable: true } },
    { field: 'total_elevation_gain', type: 'float',      schema: { is_nullable: true } },
    { field: 'average_speed',        type: 'float',      schema: { is_nullable: true } },
    { field: 'max_speed',            type: 'float',      schema: { is_nullable: true } },
    { field: 'average_cadence',      type: 'float',      schema: { is_nullable: true } },
    { field: 'average_watts',        type: 'float',      schema: { is_nullable: true } },
    { field: 'average_heartrate',    type: 'float',      schema: { is_nullable: true } },
    { field: 'max_heartrate',        type: 'float',      schema: { is_nullable: true } },
    { field: 'summary_polyline',     type: 'text',       schema: { is_nullable: true } },
    { field: 'start_lat',            type: 'float',      schema: { is_nullable: true } },
    { field: 'start_lng',            type: 'float',      schema: { is_nullable: true } },
    { field: 'splits_metric',        type: 'json',       schema: { is_nullable: true } },
    { field: 'laps',                 type: 'json',       schema: { is_nullable: true } },
    { field: 'best_efforts',         type: 'json',       schema: { is_nullable: true } },
    { field: 'calories',             type: 'float',      schema: { is_nullable: true } },
    { field: 'description',          type: 'text',       schema: { is_nullable: true } },
    { field: 'notes',                type: 'text',       schema: { is_nullable: true } },
    { field: 'gear_id',              type: 'string',     schema: { is_nullable: true, max_length: 20 } },
    { field: 'suffer_score',         type: 'integer',    schema: { is_nullable: true } },
    { field: 'pr_count',             type: 'integer',    schema: { is_nullable: true } },
    { field: 'date_created',         type: 'timestamp',  schema: { default_value: 'now()' } },
    { field: 'date_updated',         type: 'timestamp',  schema: { is_nullable: true } },
  ];
  for (const f of activityFields) await createField('activities', f);
  console.log('\n');

  // ── photos ───────────────────────────────────────────────────────────────
  await createCollection('photos', { note: 'Run photos from Runkeeper export' });
  console.log('  Fields:');
  const photoFields = [
    { field: 'activity_id',       type: 'string',  schema: { is_nullable: false, max_length: 36 } },
    { field: 'runkeeper_id',      type: 'string',  schema: { is_nullable: true, max_length: 64 } },
    { field: 'directus_file_id',  type: 'uuid',    schema: { is_nullable: true } },
    { field: 'original_filename', type: 'string',  schema: { is_nullable: false, max_length: 255 } },
    { field: 'caption',           type: 'text',    schema: { is_nullable: true } },
    { field: 'lat',               type: 'float',   schema: { is_nullable: true } },
    { field: 'lng',               type: 'float',   schema: { is_nullable: true } },
  ];
  for (const f of photoFields) await createField('photos', f);
  console.log('\n');

  // ── route_aliases ──────────────────────────────────────────────────────
  await createCollection('route_aliases', { note: 'Custom display names for run route clusters' });
  console.log('  Fields:');
  const routeAliasFields = [
    { field: 'cluster_key',  type: 'string', schema: { is_nullable: false, is_unique: true, max_length: 128 } },
    { field: 'display_name', type: 'string', schema: { is_nullable: false, max_length: 255 } },
  ];
  for (const f of routeAliasFields) await createField('route_aliases', f);
  console.log('\n');

  console.log('Schema setup complete.');
  console.log('\nNext step: set DIRECTUS_TOKEN in .env and run: npm run migrate');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
