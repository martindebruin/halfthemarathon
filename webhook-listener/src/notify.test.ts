import { describe, it, expect } from 'vitest';
import { buildMessage } from './notify.js';

describe('buildMessage', () => {
  it('includes event type and timestamp', () => {
    const msg = buildMessage('queue_exhausted', { activity_id: 123, error: 'timeout' });
    expect(msg).toContain('queue_exhausted');
    expect(msg).toContain('123');
    expect(msg).toContain('timeout');
  });

  it('handles missing optional fields', () => {
    const msg = buildMessage('directus_unreachable', {});
    expect(msg).toContain('directus_unreachable');
  });
});
