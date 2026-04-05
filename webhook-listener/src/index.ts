import 'dotenv/config';
import express from 'express';
import { webhookRouter, setQueue, processEvent } from './routes/webhook.js';
import { runRouter } from './routes/run.js';
import { log } from './logger.js';
import { openQueue } from './queue.js';
import { notify } from './notify.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

const db = openQueue();
setQueue(db.queue);

// Background worker
let isProcessing = false;

setInterval(async () => {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const pending = db.queue.getPending();
    for (const row of pending) {
      try {
        const event = JSON.parse(row.strava_event);
        await processEvent(event);
        db.queue.markDone(row.id);
      } catch (err) {
        db.queue.markFailed(row.id, String(err));
        log('warn', 'queue_event_failed', { queue_id: row.id, attempts: row.attempts + 1, error: String(err) });
        const updated = db.queue.getById(row.id);
        if (updated && updated.attempts >= 3) {
          await notify('queue_exhausted', { activity_id: JSON.parse(row.strava_event).object_id, error: String(err) });
        }
      }
    }
  } finally {
    isProcessing = false;
  }
}, 10_000);

app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/webhook', webhookRouter);
app.use('/api/run', runRouter);

async function checkDirectus(): Promise<void> {
  const url = (process.env.DIRECTUS_INTERNAL_URL ?? 'http://directus:8055') + '/server/health';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log('info', 'directus_reachable');
  } catch (err) {
    log('error', 'directus_unreachable', { error: String(err) });
    await notify('directus_unreachable', { error: String(err) });
  }
}

(async () => {
  await checkDirectus();

  app.listen(PORT, () => {
    log('info', 'server_started', { port: PORT });
  });

  process.on('uncaughtException', (err) => {
    log('error', 'uncaught_exception', { error: String(err) });
    notify('uncaught_exception', { error: String(err) }).finally(() => process.exit(1));
  });
})();
