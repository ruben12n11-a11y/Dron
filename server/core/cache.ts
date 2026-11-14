/**
 * Minimal key/value cache shared by the Express dev server and the Cloudflare
 * Worker.
 *
 * The radar and NASA proxies were originally written against a module-scope
 * `Map`. On Workers such a Map only survives while one isolate stays warm, so
 * the Worker supplies its own Cache API backed implementation of this
 * interface (see `worker/cache.ts`). Entries always carry their own
 * `fetchedAt`, which keeps the freshness checks identical in both runtimes.
 */

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  get size(): number {
    return this.entries.size;
  }
}
