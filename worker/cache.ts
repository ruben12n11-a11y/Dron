/**
 * Cloudflare Cache API backed implementation of `CacheStore`.
 *
 * A module-scope `Map` does not survive between Worker invocations, so the
 * Worker persists the radar and NASA snapshots through `caches.default`
 * instead. The stored entries keep their own `fetchedAt`, so the freshness
 * checks in `server/core/*` behave exactly as they do on the Express server.
 */

import type { CacheStore } from "../server/core/cache";

interface CacheApi {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

/**
 * `caches.default` is a Cloudflare extension, absent from the DOM lib types
 * this project compiles against, so it is reached through a narrow cast.
 */
function defaultCache(): CacheApi {
  const extension = caches as unknown as { default?: CacheApi };
  if (!extension.default) {
    throw new Error("caches.default no está disponible fuera de Cloudflare.");
  }
  return extension.default;
}

export class CloudflareCacheStore implements CacheStore {
  constructor(private readonly namespace: string) {}

  private request(key: string): Request {
    return new Request(
      `https://cache.internal/${this.namespace}/${encodeURIComponent(key)}`,
    );
  }

  async get<T>(key: string): Promise<T | undefined> {
    const hit = await defaultCache().match(this.request(key));
    if (!hit) return undefined;
    try {
      return (await hit.json()) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await defaultCache().put(
      this.request(key),
      new Response(JSON.stringify(value), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
        },
      }),
    );
  }
}
