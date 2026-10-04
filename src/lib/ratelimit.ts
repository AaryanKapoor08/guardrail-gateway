// An in-memory sliding-window rate limiter. Keeping it in memory is valid because the app runs
// as a single instance (documented limit, V§11.1). Each key remembers the times of its recent
// requests; a request is allowed while fewer than `limit` happened within the last `windowMs`.

export type RateLimiter = {
  // Counts this request and says whether it is allowed. A refused request is not counted.
  readonly allowRequest: (key: string) => boolean;
};

// Above this many keys, keys with no recent requests are dropped, so memory stays bounded.
const MAX_KEYS_BEFORE_CLEANUP = 10_000;

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now: () => Date;
}): RateLimiter {
  const requestTimes = new Map<string, number[]>();

  function recentTimes(key: string, windowStartMs: number): number[] {
    return (requestTimes.get(key) ?? []).filter((timeMs) => timeMs > windowStartMs);
  }

  function dropIdleKeys(windowStartMs: number): void {
    for (const key of [...requestTimes.keys()]) {
      if (recentTimes(key, windowStartMs).length === 0) {
        requestTimes.delete(key);
      }
    }
  }

  function allowRequest(key: string): boolean {
    const nowMs = options.now().getTime();
    const windowStartMs = nowMs - options.windowMs;
    if (requestTimes.size > MAX_KEYS_BEFORE_CLEANUP) {
      dropIdleKeys(windowStartMs);
    }
    const recent = recentTimes(key, windowStartMs);
    const isAllowed = recent.length < options.limit;
    requestTimes.set(key, isAllowed ? [...recent, nowMs] : recent);
    return isAllowed;
  }

  return { allowRequest };
}
