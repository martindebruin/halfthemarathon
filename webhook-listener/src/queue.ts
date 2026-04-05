import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface StravaEvent {
  object_type: string;
  object_id: number;
  aspect_type: string;
  owner_id: number;
  [key: string]: unknown;
}

interface QueueRow {
  id: number;
  strava_event: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventQueue {
  enqueue(event: StravaEvent): number;
  getPending(): QueueRow[];
  getById(id: number): QueueRow | undefined;
  markDone(id: number): void;
  markFailed(id: number, error: string): void;
}

export function createQueue(db: InstanceType<typeof Database>): EventQueue {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strava_event TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return {
    enqueue(event) {
      const result = db
        .prepare(`INSERT INTO pending_events (strava_event) VALUES (?)`)
        .run(JSON.stringify(event));
      return result.lastInsertRowid as number;
    },

    getPending() {
      return db.prepare(`
        SELECT * FROM pending_events
        WHERE status = 'pending'
           OR (status = 'failed' AND attempts < 3 AND (
             (attempts = 1 AND updated_at <= datetime('now', '-60 seconds'))
          OR (attempts = 2 AND updated_at <= datetime('now', '-300 seconds'))
         ))
        ORDER BY created_at ASC
      `).all() as QueueRow[];
    },

    getById(id) {
      return db.prepare(`SELECT * FROM pending_events WHERE id = ?`).get(id) as QueueRow | undefined;
    },

    markDone(id) {
      db.prepare(`UPDATE pending_events SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(id);
    },

    markFailed(id, error) {
      db.prepare(`
        UPDATE pending_events
        SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(error, id);
    },
  };
}

export function openQueue(): InstanceType<typeof Database> & { queue: EventQueue } {
  const dbPath = process.env.QUEUE_DB_PATH ?? path.join(process.cwd(), 'data/queue.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath) as InstanceType<typeof Database> & { queue: EventQueue };
  db.queue = createQueue(db);
  return db;
}
