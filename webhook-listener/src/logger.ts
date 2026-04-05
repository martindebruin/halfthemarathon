type Level = 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: Level;
  event: string;
  activity_id?: number;
  error?: string;
  [key: string]: unknown;
}

export function log(level: Level, event: string, extra?: Partial<Omit<LogEntry, 'timestamp' | 'level' | 'event'>>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...extra,
  };
  process.stdout.write(JSON.stringify(entry) + '\n');
}
