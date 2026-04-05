import { Router } from 'express';
import type { Request, Response } from 'express';
import { fetchActivity, fetchActivityPhotos } from '../strava.js';
import { upsertStravaActivity, syncStravaPhotos } from '../directus.js';
import { log } from '../logger.js';
import type { StravaEvent, EventQueue } from '../queue.js';

export const webhookRouter = Router();

// Injected at startup
let _queue: EventQueue | undefined;
export function setQueue(q: EventQueue) { _queue = q; }

webhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    log('info', 'webhook_verified');
    res.json({ 'hub.challenge': challenge });
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

webhookRouter.post('/', (req: Request, res: Response) => {
  if (!_queue) {
    log('error', 'queue_not_initialized');
    res.status(503).json({ error: 'Service not ready' });
    return;
  }
  const event = req.body as StravaEvent;
  log('info', 'webhook_received', { object_type: event.object_type, object_id: event.object_id, aspect_type: event.aspect_type });

  const id = _queue.enqueue(event);
  log('info', 'webhook_queued', { queue_id: id, activity_id: event.object_id });

  res.status(200).json({ status: 'queued' });
});

export async function processEvent(event: StravaEvent): Promise<void> {
  if (event.object_type !== 'activity') return;
  if (event.aspect_type !== 'create' && event.aspect_type !== 'update') return;

  log('info', 'activity_sync_start', { activity_id: event.object_id });
  const activity = await fetchActivity(event.object_id);
  const directusId = await upsertStravaActivity(activity as Record<string, unknown>);
  const photos = await fetchActivityPhotos(event.object_id);
  if (photos.length > 0) {
    await syncStravaPhotos(directusId, photos);
    log('info', 'photos_synced', { activity_id: event.object_id, count: photos.length });
  }
  log('info', 'activity_sync_done', { activity_id: event.object_id });
}
