import fs from 'fs';
import initSqlJs from 'sql.js';
import { fetchAppRunsMissingCalories, patchActivityCalories } from './directus.js';
import { log } from './logger.js';

// Health Connect's session starts within seconds of the app's own recording.
const TOLERANCE_MS = 2 * 60 * 1000;
// The phone exports once a day, so a run's calories land a day or so later;
// the window leaves room for a phone that was offline for a while.
const LOOKBACK_DAYS = 45;
const INTERVAL_MS = 60 * 60 * 1000;

export interface HealthWorkout {
  start_time: string;
  calories_kcal: number | null;
}

export function matchWorkout<W extends HealthWorkout>(runDate: string, workouts: W[]): W | null {
  const t = new Date(runDate).getTime();
  let best: W | null = null;
  let bestGap = Infinity;
  for (const w of workouts) {
    if (!w.calories_kcal) continue;
    const gap = Math.abs(new Date(w.start_time).getTime() - t);
    if (gap <= TOLERANCE_MS && gap < bestGap) {
      best = w;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Fills calories on app runs from the health-sync database (Health Connect
 * export). Read-only: health-sync is that database's only writer. Never
 * overwrites a value that is already set.
 */
export async function fillCaloriesFromHealth(): Promise<void> {
  const dbPath = process.env.HEALTH_DB_PATH;
  if (!dbPath || !fs.existsSync(dbPath)) return;

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();
  const runs = await fetchAppRunsMissingCalories(since);
  if (runs.length === 0) return;

  // sql.js (WASM) rather than a native addon: better-sqlite3 segfaulted on
  // node:20-alpine. The whole file is read into memory, which is fine at ~15 MB.
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const workouts: HealthWorkout[] = [];
  try {
    const stmt = db.prepare(
      `SELECT start_time, calories_kcal FROM workout
       WHERE exercise_name = 'running' AND start_time >= ?`
    );
    stmt.bind([since.slice(0, 10)]);
    while (stmt.step()) workouts.push(stmt.getAsObject() as unknown as HealthWorkout);
    stmt.free();
  } finally {
    db.close();
  }

  for (const run of runs) {
    const w = matchWorkout(run.date, workouts);
    if (!w) continue;
    const kcal = Math.round(w.calories_kcal! * 10) / 10;
    await patchActivityCalories(String(run.id), kcal);
    log('info', 'calories_filled', { activityId: run.id, kcal });
  }
}

export function scheduleHealthCalories(): void {
  const run = () => fillCaloriesFromHealth()
    .catch((err) => log('warn', 'calories_fill_failed', { error: String(err) }));
  run();
  setInterval(run, INTERVAL_MS).unref();
}
