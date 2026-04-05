import { Router } from 'express';
import type { Request, Response } from 'express';
import { upsertAppRun } from '../directus.js';
import { log } from '../logger.js';
import type { AppRunPayload } from '../directus.js';

export const runRouter = Router();

export function validateAppRunPayload(
  body: unknown
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

runRouter.post('/', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== process.env.APP_BEARER_TOKEN) {
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
    await upsertAppRun(validation.payload);
    log('info', 'app_run_saved', { app_run_id: validation.payload.app_run_id });
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    log('error', 'app_run_failed', { app_run_id: validation.payload.app_run_id, error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});
