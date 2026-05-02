// Tiny in-memory TTL cache. Lives for the lifetime of the Node process,
// which is exactly what we want for `next dev` / single-instance deploys.
// On Vercel / multi-replica setups this fragments per process - swap the
// three exports below for a Redis client when that becomes a problem.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const STORE = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const hit = STORE.get(key) as Entry<T> | undefined;
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    STORE.delete(key);
    return undefined;
  }
  return hit.value;
}

export function cacheSet<T>(key: string, value: T, ttlSeconds: number): void {
  STORE.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
  });
}

// Fetch-or-compute. If `staleOnError` is set and the loader throws, return
// the previous value instead of bubbling the error - keeps the UI populated
// during a transient upstream blip.
export async function cacheFetch<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  options: { staleOnError?: boolean } = {},
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;

  try {
    const fresh = await loader();
    cacheSet(key, fresh, ttlSeconds);
    return fresh;
  } catch (err) {
    if (options.staleOnError) {
      const stale = STORE.get(key) as Entry<T> | undefined;
      if (stale) return stale.value;
    }
    throw err;
  }
}
