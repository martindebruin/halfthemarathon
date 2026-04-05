import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createQueue, type EventQueue } from './queue.js';

describe('EventQueue', () => {
  let db: InstanceType<typeof Database>;
  let queue: EventQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    queue = createQueue(db);
  });

  afterEach(() => db.close());

  it('enqueues an event and returns an id', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 1, aspect_type: 'create', owner_id: 99 });
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('picks up pending events', () => {
    queue.enqueue({ object_type: 'activity', object_id: 1, aspect_type: 'create', owner_id: 99 });
    const pending = queue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });

  it('marks event as done', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 2, aspect_type: 'update', owner_id: 99 });
    queue.markDone(id);
    expect(queue.getPending()).toHaveLength(0);
  });

  it('increments attempt count and marks failed', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 3, aspect_type: 'create', owner_id: 99 });
    queue.markFailed(id, 'timeout');
    const row = queue.getById(id);
    expect(row?.attempts).toBe(1);
    expect(row?.status).toBe('failed');
    expect(row?.last_error).toBe('timeout');
  });

  it('does not return failed events with attempts >= 3', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 4, aspect_type: 'create', owner_id: 99 });
    queue.markFailed(id, 'err');
    queue.markFailed(id, 'err');
    queue.markFailed(id, 'err');
    expect(queue.getPending()).toHaveLength(0);
  });

  it('returns failed events ready for retry after backoff', () => {
    const id = queue.enqueue({ object_type: 'activity', object_id: 5, aspect_type: 'create', owner_id: 99 });
    // Force updated_at into the past
    db.prepare("UPDATE pending_events SET updated_at = datetime('now', '-120 seconds'), attempts = 1, status = 'failed' WHERE id = ?").run(id);
    const pending = queue.getPending();
    expect(pending.some((r) => r.id === id)).toBe(true);
  });
});
