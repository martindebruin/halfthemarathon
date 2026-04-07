import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { upsertAppRun, uploadPhotoForAppRun } from '../directus.js';
import { generateAndSaveHeadline } from '../headline.js';
import { matchAndAssignRoute } from '../route-matcher.js';
import { log } from '../logger.js';
import type { AppRunPayload } from '../directus.js';

export const runRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function validateAppRunPayload(
  body: unknown,
): { valid: true; payload: AppRunPayload } | { valid: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { valid: false, error: 'Body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  if (!b.app_run_id || typeof b.app_run_id !== 'string') {
    return { valid: false, error: 'Missing required field: app_run_id' };
  }
  if (!b.started_at || typeof b.started_at !== 'string') {
    return { valid: false, error: 'Missing required field: started_at' };
  }
  if (typeof b.distance_m !== 'number') {
    return { valid: false, error: 'Missing required field: distance_m (must be number)' };
  }
  if (typeof b.moving_time_s !== 'number') {
    return { valid: false, error: 'Missing required field: moving_time_s (must be number)' };
  }
  return { valid: true, payload: b as unknown as AppRunPayload };
}

function checkAuth(req: Request): boolean {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return !!(token && token === process.env.APP_BEARER_TOKEN);
}

runRouter.post('/', async (req: Request, res: Response) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const validation = validateAppRunPayload(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    log('info', 'app_run_received', { app_run_id: validation.payload.app_run_id });
    const activityId = await upsertAppRun(validation.payload);
    log('info', 'app_run_saved', { app_run_id: validation.payload.app_run_id });
    res.status(200).json({ status: 'ok' });

    // Fire-and-forget: generate headline after response is sent
    const p = validation.payload;
    generateAndSaveHeadline(
      activityId,
      p.started_at,
      p.start_lat ?? null,
      p.start_lng ?? null,
    ).catch(err => log('warn', 'headline_failed', { error: String(err) }));

    // Fire-and-forget: match to known route if polyline available
    if (p.summary_polyline && p.distance_m) {
      matchAndAssignRoute(activityId, p.summary_polyline, p.distance_m)
        .catch(err => log('warn', 'route_match_failed', { error: String(err) }));
    }
  } catch (err) {
    log('error', 'app_run_failed', { app_run_id: validation.payload.app_run_id, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

runRouter.post('/:id/photo', upload.single('photo'), async (req: Request, res: Response) => {
  if (!checkAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No photo attached' });
    return;
  }
  const appRunId = req.params.id;
  try {
    log('info', 'app_photo_received', { app_run_id: appRunId });
    const assetUrl = await uploadPhotoForAppRun(appRunId, req.file.buffer, req.file.mimetype);
    if (assetUrl === null) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    log('info', 'app_photo_saved', { app_run_id: appRunId });
    res.status(200).json({ asset_url: assetUrl });
  } catch (err) {
    log('error', 'app_photo_failed', { app_run_id: appRunId, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});
