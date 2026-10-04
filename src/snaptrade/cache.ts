// A small in-memory cache with a time-to-live per entry (PRODUCT_VISION §12.3). In-process
// caching is valid because the app runs as a single instance (documented limit).

export type TtlCache<K, V> = {
  readonly get: (key: K) => V | undefined;
  // `ttlMs` overrides the cache's default for this one entry (e.g. a document's own max-age).
  readonly set: (key: K, value: V, ttlMs?: number) => void;
  readonly delete: (key: K) => void;
  readonly deleteWhere: (shouldDelete: (key: K) => boolean) => void;
  // Returns the cached value, or runs `loader` once and caches its result. Callers asking for
  // the same key while a load is running share that load instead of starting another one.
  readonly getOrLoad: (key: K, loader: () => Promise<V>) => Promise<V>;
};

type Entry<V> = { readonly value: V; readonly expiresAtMs: number };

export function createTtlCache<K, V>(options: { ttlMs: number; now: () => Date }): TtlCache<K, V> {
  const entries = new Map<K, Entry<V>>();
  const loadsInFlight = new Map<K, Promise<V>>();

  function get(key: K): V | undefined {
    const entry = entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAtMs <= options.now().getTime()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key: K, value: V, ttlMs: number = options.ttlMs): void {
    entries.set(key, { value, expiresAtMs: options.now().getTime() + ttlMs });
  }

  function deleteWhere(shouldDelete: (key: K) => boolean): void {
    for (const key of [...entries.keys()]) {
      if (shouldDelete(key)) {
        entries.delete(key);
      }
    }
  }

  async function load(key: K, loader: () => Promise<V>): Promise<V> {
    try {
      const value = await loader();
      set(key, value);
      return value;
    } finally {
      // Failures are not cached: the next caller tries again.
      loadsInFlight.delete(key);
    }
  }

  function getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }
    const inFlight = loadsInFlight.get(key);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const loading = load(key, loader);
    loadsInFlight.set(key, loading);
    return loading;
  }

  return { get, set, delete: (key) => entries.delete(key), deleteWhere, getOrLoad };
}
