/**
 * Tiny in-memory TTL cache.
 *
 * The dashboard polls on a short interval and we don't want each request to
 * hammer Yahoo/Google. We use a simple Map keyed by a string and store a
 * timestamp alongside the value. Anything expired is treated as a miss.
 *
 * This is module-scoped which means it lives for the lifetime of the Node
 * process - perfect for `next dev`/`next start`. For multi-instance
 * deployments (Vercel/Lambda) you would swap this for Redis behind the same
 * `get`/`set` interface, but the call sites would not change.
 */

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

/**
 * Fetch-or-compute helper. If the cache has a fresh value it is returned
 * immediately; otherwise `loader` runs and its result is cached.
 *
 * If the loader throws and `staleOnError` is provided, we return the stale
 * value rather than bubbling the error up - this keeps the UI populated
 * during transient upstream outages.
 */
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
