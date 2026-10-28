/** Injectable time source so pacing is testable without real waiting. */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface PacerOptions {
  /** Minimum gap between call starts. Chrome allows 2 captureVisibleTab calls/s. */
  minIntervalMs: number;
  /** Wait after a quota error before retrying. */
  backoffMs: number;
  maxRetries: number;
}

export const CAPTURE_PACING: PacerOptions = { minIntervalMs: 550, backoffMs: 600, maxRetries: 5 };

/** Chrome's quota error reads "...MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota". */
export function isQuotaError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(msg);
}

/**
 * CAPTURE §9: spaces calls at least `minIntervalMs` apart and retries quota errors with
 * backoff. Other errors propagate immediately; they are not rate-limit problems.
 */
export class Pacer {
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly opts: PacerOptions = CAPTURE_PACING,
    private readonly clock: Clock = realClock,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.opts.minIntervalMs - this.clock.now();
      if (wait > 0) await this.clock.sleep(wait);
      this.last = this.clock.now();
      try {
        return await fn();
      } catch (e) {
        if (!isQuotaError(e) || attempt >= this.opts.maxRetries) throw e;
        await this.clock.sleep(this.opts.backoffMs);
      }
    }
  }
}
