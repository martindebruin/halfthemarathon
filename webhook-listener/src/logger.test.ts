import { describe, it, expect, vi } from 'vitest';

describe('log', () => {
  it('writes a JSON line to stdout', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const { log } = await import('./logger.js');
    log('info', 'test_event', { activity_id: 42 });

    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trim());
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe('test_event');
    expect(parsed.activity_id).toBe(42);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    writeSpy.mockRestore();
  });
});
