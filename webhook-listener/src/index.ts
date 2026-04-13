import 'dotenv/config';
import express from 'express';
import { runRouter } from './routes/run.js';
import { log } from './logger.js';
import { notify } from './notify.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
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
