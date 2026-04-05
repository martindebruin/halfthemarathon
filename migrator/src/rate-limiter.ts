function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextMidnightUTC(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function next15Min(): Date {
  const now = Date.now();
  const interval = 15 * 60 * 1000;
  return new Date(Math.ceil(now / interval) * interval);
}

export class StravaRateLimiter {
  private shortBucket = { tokens: 90, resetAt: next15Min() };
  private dailyBucket = { tokens: 900, resetAt: nextMidnightUTC() };

  async acquire(): Promise<void> {
    await this.waitForBucket(this.shortBucket, 90, () => next15Min());
    await this.waitForBucket(this.dailyBucket, 900, () => nextMidnightUTC());
  }

  private async waitForBucket(
    bucket: { tokens: number; resetAt: Date },
    capacity: number,
    getResetAt: () => Date
  ): Promise<void> {
    const now = new Date();
    if (now >= bucket.resetAt) {
      bucket.tokens = capacity;
      bucket.resetAt = getResetAt();
    }

    if (bucket.tokens <= 0) {
      const waitMs = bucket.resetAt.getTime() - Date.now();
      const waitSec = Math.ceil(waitMs / 1000);
      console.log(`Rate limit: waiting ${waitSec}s until ${bucket.resetAt.toISOString()}`);
      await sleep(waitMs + 500); // small buffer
      bucket.tokens = capacity;
      bucket.resetAt = getResetAt();
    }

    bucket.tokens--;
  }

  get shortRemaining(): number { return this.shortBucket.tokens; }
  get dailyRemaining(): number { return this.dailyBucket.tokens; }
}
