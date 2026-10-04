// A clock tests can move by hand, injected as `deps.now`.

export type TestClock = {
  readonly now: () => Date;
  readonly advanceMs: (ms: number) => void;
  readonly set: (date: Date) => void;
};

// A Monday, mid-afternoon in Toronto (14:00 UTC = 10:00 ET).
export const DEFAULT_TEST_START = new Date('2026-10-05T14:00:00Z');

export function createTestClock(start: Date = DEFAULT_TEST_START): TestClock {
  let currentMs = start.getTime();
  return {
    now: () => new Date(currentMs),
    advanceMs: (ms) => {
      currentMs += ms;
    },
    set: (date) => {
      currentMs = date.getTime();
    },
  };
}
