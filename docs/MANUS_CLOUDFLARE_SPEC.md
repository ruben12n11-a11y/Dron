# Especificación para Manus AI — Backend Cloudflare de Drone Radar

## PROMPT PARA MANUS (pega esto primero)

> Trabaja en el repositorio `ruben12n11-a11y/Dron`. Vas a portar el backend
> (radar OpenSky + NASA EONET/DONKI) a **Cloudflare Workers** sin duplicar
> lógica, extrayéndola a un núcleo compartido en `server/core/`, y a preparar el
> frontend web para **Cloudflare Pages**.
>
> Reglas obligatorias:
> 1. **No inventes datos ni uses datos sintéticos.** Las únicas fuentes son
>    OpenSky, NASA EONET y NASA DONKI.
> 2. Copia **tal cual** el contenido de los archivos de las secciones 2 y 3. No
>    reescribas la lógica ni la "mejores".
> 3. Respeta la decisión de arquitectura de la sección 1.
> 4. Cumple los criterios de verificación de la sección 6 antes de dar por
>    terminado.
> 5. Lee las trampas conocidas de la sección 7.
>
> Empieza creando los archivos de la sección 2, luego sobrescribe los de la
> sección 3, mueve `server/geo.ts` (sección 4) y ejecuta la verificación.

---

Documento autocontenido. Aplica los cambios en el repositorio
`ruben12n11-a11y/Dron` (Expo/React Native + servidor Express que hace de
proxy de OpenSky y NASA). No inventes datos ni sustituyas las fuentes reales.

> Regla de oro: **todo el contenido de los archivos de las secciones 2 y 3 se
> copia tal cual**. No reinterpretes la lógica ni la reescribas.

## 0. Objetivo

Portar el backend real (radar OpenSky + NASA EONET/DONKI) a **Cloudflare
Workers** sin duplicar lógica, y dejar lista la base para desplegar el
frontend web en **Cloudflare Pages**.

## 1. Decisión de arquitectura (respétala)

La lógica NO se copia: se extrae a un **núcleo neutral respecto al entorno**
en `server/core/`. Express y Workers pasan a ser **adaptadores finos**.

```
worker/index.ts (router + CORS)  ─┐
server/{radar,nasa}.ts (Express) ─┴─► server/core/* ─► OpenSky / EONET / DONKI
```

La **única** diferencia real entre ambos entornos es la caché:

| Entorno | `CacheStore` | Motivo |
| --- | --- | --- |
| Express local | `MemoryCacheStore` (`Map`) | Un solo proceso persistente |
| Cloudflare Worker | `CloudflareCacheStore` (`caches.default`) | Un `Map` no sobrevive entre invocaciones |

## 2. Archivos NUEVOS (crear tal cual)

### `server/core/cache.ts` — Núcleo: caché con interfaz `CacheStore`

```ts
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
```

### `server/core/geo.ts` — Núcleo: geoespacial (movido desde `server/geo.ts`)

```ts
/** Shared geospatial helpers for the API proxies (radar and NASA). */

export const EARTH_RADIUS_KM = 6371;

export function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function longitudeDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
  key: string;
  global: boolean;
}

export function buildBoundingBox(
  lat: number,
  lon: number,
  radiusKm: number,
): BoundingBox {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(0.05, Math.cos(toRad(lat))));
  const lamin = clamp(lat - latDelta, -90, 90);
  const lamax = clamp(lat + latDelta, -90, 90);
  const wraps = lon - lonDelta < -180 || lon + lonDelta > 180;

  if (wraps) {
    // A single bbox cannot represent an antimeridian crossing; fetch the full
    // longitude band and let the exact haversine filter decide.
    return { lamin, lamax, lomin: -180, lomax: 180, key: "global", global: true };
  }

  const roundDown = (value: number) => Math.floor(value * 10) / 10;
  const roundUp = (value: number) => Math.ceil(value * 10) / 10;
  const box = {
    lamin: roundDown(lamin),
    lomin: roundDown(lon - lonDelta),
    lamax: roundUp(lamax),
    lomax: roundUp(lon + lonDelta),
  };

  return {
    ...box,
    key: `${box.lamin},${box.lomin},${box.lamax},${box.lomax}`,
    global: false,
  };
}
```

### `server/core/radar-service.ts` — Núcleo: servicio de radar (OpenSky)

```ts
/**
 * OpenSky ADS-B proxy logic, shared by the Express dev server and the
 * Cloudflare Worker. The HTTP layer is the only thing that differs between the
 * two; every validation, freshness and filtering rule lives here so both
 * runtimes behave identically.
 */

import type { CacheStore } from "./cache";
import {
  buildBoundingBox,
  clamp,
  haversineKm,
  longitudeDelta,
  numeric,
  toRad,
  type BoundingBox,
} from "./geo";

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const CACHE_TTL_MS = 30_000;
const CACHE_TTL_SECONDS = 30;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SOURCE_AGE_MS = 5 * 60_000;
export const MAX_RADIUS_KM = 250;
const MAX_RESULTS = 150;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
const ERROR_COOLDOWN_MS = 2 * 60_000;

const METERS_TO_FEET = 3.28084;
const MPS_TO_KNOTS = 1.943844;
const MPS_TO_FPM = 196.8504;

export interface RadarEnv {
  OPENSKY_CLIENT_ID?: string;
  OPENSKY_CLIENT_SECRET?: string;
}

export interface ServerAircraft {
  icao: string;
  callsign: string;
  lat: number;
  lon: number;
  altFt: number;
  speedKt: number;
  headingDeg: number;
  verticalRateFpm: number;
  category: number | null;
}

interface AircraftSnapshot {
  fetchedAt: number;
  sourceTimestamp: number;
  aircraft: ServerAircraft[];
}

export interface RadarStates {
  fetchedAt: number;
  sourceTimestamp: number;
  states: ServerAircraft[];
}

export interface RadarHealth {
  ok: true;
  source: "opensky";
  cacheAgeMs: number | null;
  sourceTimestamp: number | null;
  sourceAgeMs: number | null;
  fresh: boolean;
  cachedBoxes: number;
  cooldownUntil: number | null;
}

export interface RadarServiceOptions {
  cache: CacheStore;
  env?: RadarEnv;
  fetchImpl?: typeof fetch;
}

export class RadarService {
  private readonly cache: CacheStore;
  private readonly env: RadarEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly inFlight = new Map<string, Promise<AircraftSnapshot>>();
  private readonly seenBoxes = new Set<string>();
  private lastCacheKey: string | null = null;
  private lastSnapshot: AircraftSnapshot | null = null;
  private cooldownUntil = 0;
  private lastError: string | null = null;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(options: RadarServiceOptions) {
    this.cache = options.cache;
    this.env = options.env ?? {};
    // Workers requires `fetch` to be called with the global receiver; storing it
    // as a plain property and invoking it as a method triggers "Illegal
    // invocation", so it is bound to `globalThis` here.
    this.fetchImpl = (options.fetchImpl ?? fetch).bind(globalThis);
  }

  private cacheKey(box: BoundingBox): string {
    return `radar:${box.key}`;
  }

  private async getAccessToken(): Promise<string | null> {
    const clientId = this.env.OPENSKY_CLIENT_ID;
    const clientSecret = this.env.OPENSKY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!payload.access_token) return null;
      this.tokenCache = {
        token: payload.access_token,
        expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
      };
      return this.tokenCache.token;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private mapAircraft(state: unknown): ServerAircraft | null {
    if (!Array.isArray(state)) return null;

    const icao = typeof state[0] === "string" ? state[0].toLowerCase() : null;
    const lat = numeric(state[6]);
    const lon = numeric(state[5]);
    const onGround = state[8] === true;
    const baroAltitude = numeric(state[7]);
    const geoAltitude = numeric(state[13]);
    const altitudeM = geoAltitude ?? baroAltitude;

    if (
      !icao ||
      !/^[0-9a-f]{6}$/.test(icao) ||
      lat === null ||
      lat < -90 ||
      lat > 90 ||
      lon === null ||
      lon < -180 ||
      lon > 180 ||
      onGround ||
      altitudeM === null
    ) {
      return null;
    }

    const callsign =
      typeof state[1] === "string" ? state[1].trim().toUpperCase() : "";
    const velocity = numeric(state[9]);
    const heading = numeric(state[10]);
    const verticalRate = numeric(state[11]);
    // Field 17 is the ADS-B emitter category in the extended state vector.
    // Field 16 is position source and must not be interpreted as a category.
    const rawCategory = numeric(state[17]);
    const category =
      rawCategory !== null && rawCategory >= 0 && rawCategory <= 20
        ? rawCategory
        : null;

    return {
      icao,
      callsign,
      lat,
      lon,
      altFt: altitudeM * METERS_TO_FEET,
      speedKt: (velocity ?? 0) * MPS_TO_KNOTS,
      headingDeg: heading ?? 0,
      verticalRateFpm: (verticalRate ?? 0) * MPS_TO_FPM,
      category,
    };
  }

  private async fetchOpenSky(box: BoundingBox): Promise<AircraftSnapshot> {
    const key = this.cacheKey(box);
    const cached = await this.cache.get<AircraftSnapshot>(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      this.lastCacheKey = key;
      this.lastSnapshot = cached;
      return cached;
    }

    if (Date.now() < this.cooldownUntil) {
      throw new Error(
        this.lastError ??
          "OpenSky está limitando las consultas. No se mostrarán contactos hasta que el enlace se recupere.",
      );
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<AircraftSnapshot> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const token = await this.getAccessToken();
        const url = new URL(OPENSKY_URL);
        if (!box.global) {
          url.searchParams.set("lamin", box.lamin.toFixed(3));
          url.searchParams.set("lomin", box.lomin.toFixed(3));
          url.searchParams.set("lamax", box.lamax.toFixed(3));
          url.searchParams.set("lomax", box.lomax.toFixed(3));
        }

        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "drone-radar-mobile/1.0",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (response.status === 429) {
          this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          this.lastError =
            "OpenSky alcanzó el límite de consultas. Espera al siguiente intento o configura credenciales OAuth.";
          throw new Error(this.lastError);
        }
        if (response.status === 401 || response.status === 403) {
          this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
          this.lastError =
            "OpenSky rechazó la consulta. Define OPENSKY_CLIENT_ID y OPENSKY_CLIENT_SECRET para usar una cuenta autenticada.";
          throw new Error(this.lastError);
        }
        if (!response.ok) {
          this.cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
          this.lastError = `OpenSky respondió ${response.status}.`;
          throw new Error(this.lastError);
        }

        const payload = (await response.json()) as {
          time?: number;
          states?: unknown[] | null;
        };
        const upstreamTime = numeric(payload.time);
        if (upstreamTime === null || upstreamTime <= 0) {
          throw new Error("OpenSky no incluyó una marca de tiempo de origen válida.");
        }
        const sourceTimestamp = upstreamTime * 1000;
        const sourceAgeMs = Date.now() - sourceTimestamp;
        if (sourceAgeMs < -60_000 || sourceAgeMs > MAX_SOURCE_AGE_MS) {
          this.cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
          throw new Error("La muestra de OpenSky está vencida; se rechaza como dato en vivo.");
        }
        const aircraft = (payload.states ?? [])
          .map((state) => this.mapAircraft(state))
          .filter((item): item is ServerAircraft => item !== null);

        const snapshot: AircraftSnapshot = {
          // Use local fetch time for TTL. OpenSky's snapshot timestamp can lag,
          // which would otherwise make a fresh cache look expired immediately.
          fetchedAt: Date.now(),
          sourceTimestamp,
          aircraft,
        };
        await this.cache.set(key, snapshot, CACHE_TTL_SECONDS);
        this.seenBoxes.add(key);
        this.lastCacheKey = key;
        this.lastSnapshot = snapshot;
        this.lastError = null;
        this.cooldownUntil = 0;
        return snapshot;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          this.lastError = "OpenSky tardó demasiado en responder.";
        } else if (error instanceof Error && error.message) {
          this.lastError = error.message;
        } else {
          this.lastError = "No se pudo consultar OpenSky.";
        }
        throw new Error(this.lastError);
      } finally {
        clearTimeout(timeout);
      }
    })();

    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async states(lat: number, lon: number, radiusKm: number): Promise<RadarStates> {
    const radius = clamp(radiusKm, 1, MAX_RADIUS_KM);
    const box = buildBoundingBox(lat, lon, radius);
    const latDelta = radius / 111;
    const lonDelta = radius / (111 * Math.max(0.05, Math.cos(toRad(lat))));

    const snapshot = await this.fetchOpenSky(box);
    const states = snapshot.aircraft
      .filter(
        (aircraft) =>
          Math.abs(aircraft.lat - lat) <= latDelta &&
          longitudeDelta(aircraft.lon, lon) <= lonDelta,
      )
      .map((aircraft) => ({
        ...aircraft,
        distKm: haversineKm(lat, lon, aircraft.lat, aircraft.lon),
      }))
      .filter((aircraft) => aircraft.distKm <= radius)
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, MAX_RESULTS)
      .map(({ distKm: _distKm, ...aircraft }) => aircraft);

    return {
      fetchedAt: snapshot.fetchedAt,
      sourceTimestamp: snapshot.sourceTimestamp,
      states,
    };
  }

  async health(): Promise<RadarHealth> {
    const latest = this.lastSnapshot;
    return {
      ok: true,
      source: "opensky",
      cacheAgeMs: latest ? Date.now() - latest.fetchedAt : null,
      sourceTimestamp: latest?.sourceTimestamp ?? null,
      sourceAgeMs: latest
        ? Math.max(0, Date.now() - latest.sourceTimestamp)
        : null,
      fresh: latest
        ? Date.now() - latest.sourceTimestamp <= MAX_SOURCE_AGE_MS
        : false,
      cachedBoxes: this.seenBoxes.size,
      cooldownUntil: this.cooldownUntil || null,
    };
  }
}
```

### `server/core/nasa-service.ts` — Núcleo: servicio NASA (EONET + DONKI)

```ts
/**
 * NASA proxy logic (EONET natural hazards and DONKI space weather), shared by
 * the Express dev server and the Cloudflare Worker.
 */

import type { CacheStore } from "./cache";
import {
  buildBoundingBox,
  clamp,
  haversineKm,
  longitudeDelta,
  numeric,
  toRad,
} from "./geo";

const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events";
const DONKI_GST_URL = "https://api.nasa.gov/DONKI/GST";

const REQUEST_TIMEOUT_MS = 20_000;
const HAZARD_CACHE_TTL_MS = 10 * 60_000;
const HAZARD_CACHE_TTL_SECONDS = 10 * 60;
const SPACE_WEATHER_CACHE_TTL_MS = 30 * 60_000;
const SPACE_WEATHER_CACHE_TTL_SECONDS = 30 * 60;
export const MAX_RADIUS_KM = 500;
const MAX_HAZARDS = 40;
const SPACE_WEATHER_LOOKBACK_DAYS = 7;

/** Geomagnetic Kp at or above this level degrades GNSS accuracy. */
export const KP_GNSS_RISK_THRESHOLD = 5;

export interface NasaEnv {
  NASA_API_KEY?: string;
}

export interface HazardEvent {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  categoryId: string;
  categoryTitle: string;
  lat: number;
  lon: number;
  observedAt: number;
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
}

export interface SpaceWeatherSample {
  kpIndex: number;
  observedAt: number;
}

export interface SpaceWeather {
  /** Highest Kp observed inside the lookback window, or null when none. */
  maxKpIndex: number | null;
  observedAt: number | null;
  samples: SpaceWeatherSample[];
  /** True when the latest Kp at or above the threshold can degrade GNSS. */
  gnssRisk: boolean;
}

export interface NasaHazards {
  fetchedAt: number;
  hazards: (HazardEvent & { distanceKm: number })[];
}

export interface NasaHealth {
  ok: true;
  sources: string[];
  hasApiKey: boolean;
  cachedBoxes: number;
  spaceWeatherCachedAt: number | null;
  lastHazardError: string | null;
  lastSpaceWeatherError: string | null;
}

export interface NasaServiceOptions {
  cache: CacheStore;
  env?: NasaEnv;
  fetchImpl?: typeof fetch;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoTime(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Maps one raw EONET event to a hazard, keeping the most recent geometry that
 * falls inside the requested circle. Returns null for unusable records.
 */
export function mapHazard(
  event: unknown,
  centerLat: number,
  centerLon: number,
  radiusKm: number,
): HazardEvent | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const title = typeof record.title === "string" ? record.title : null;
  const geometry = Array.isArray(record.geometry) ? record.geometry : [];
  if (!id || !title || geometry.length === 0) return null;

  const categories = Array.isArray(record.categories) ? record.categories : [];
  const firstCategory = categories[0] as Record<string, unknown> | undefined;
  const categoryId =
    firstCategory && typeof firstCategory.id === "string"
      ? firstCategory.id
      : "unknown";
  const categoryTitle =
    firstCategory && typeof firstCategory.title === "string"
      ? firstCategory.title
      : "Evento";

  let best: HazardEvent | null = null;
  for (const item of geometry) {
    if (!item || typeof item !== "object") continue;
    const point = item as Record<string, unknown>;
    const coordinates = Array.isArray(point.coordinates) ? point.coordinates : null;
    if (!coordinates || coordinates.length < 2) continue;
    const lon = numeric(coordinates[0]);
    const lat = numeric(coordinates[1]);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      continue;
    }
    if (haversineKm(centerLat, centerLon, lat, lon) > radiusKm) continue;
    const observedAt = parseIsoTime(point.date) ?? 0;
    if (best && observedAt <= best.observedAt) continue;
    best = {
      id,
      title,
      description: typeof record.description === "string" ? record.description : null,
      link: typeof record.link === "string" ? record.link : null,
      categoryId,
      categoryTitle,
      lat,
      lon,
      observedAt,
      magnitudeValue: numeric(point.magnitudeValue),
      magnitudeUnit:
        typeof point.magnitudeUnit === "string" ? point.magnitudeUnit : null,
    };
  }

  return best;
}

export function mapSpaceWeather(payload: unknown, now = Date.now()): SpaceWeather {
  const events = Array.isArray(payload) ? payload : [];
  const samples: SpaceWeatherSample[] = [];

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const allKp = (event as Record<string, unknown>).allKpIndex;
    if (!Array.isArray(allKp)) continue;
    for (const entry of allKp) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const kpIndex = numeric(record.kpIndex);
      const observedAt = parseIsoTime(record.observedTime);
      if (kpIndex === null || observedAt === null) continue;
      samples.push({ kpIndex, observedAt });
    }
  }

  samples.sort((a, b) => a.observedAt - b.observedAt);
  const recent = samples.filter(
    (sample) => now - sample.observedAt <= SPACE_WEATHER_LOOKBACK_DAYS * 86_400_000,
  );
  const window = recent.length > 0 ? recent : samples;
  if (window.length === 0) {
    return { maxKpIndex: null, observedAt: null, samples: [], gnssRisk: false };
  }

  let maxKpIndex = window[0].kpIndex;
  let observedAt = window[0].observedAt;
  for (const sample of window) {
    if (sample.kpIndex > maxKpIndex) {
      maxKpIndex = sample.kpIndex;
      observedAt = sample.observedAt;
    }
  }

  return {
    maxKpIndex,
    observedAt,
    samples: window.slice(-24),
    gnssRisk: maxKpIndex >= KP_GNSS_RISK_THRESHOLD,
  };
}

export class NasaService {
  private readonly cache: CacheStore;
  private readonly env: NasaEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly hazardInFlight = new Map<string, Promise<HazardEvent[]>>();
  private readonly seenBoxes = new Set<string>();
  private spaceWeatherInFlight: Promise<SpaceWeather> | null = null;
  private spaceWeatherCachedAt: number | null = null;
  private lastHazardError: string | null = null;
  private lastSpaceWeatherError: string | null = null;

  constructor(options: NasaServiceOptions) {
    this.cache = options.cache;
    this.env = options.env ?? {};
    // Workers requires `fetch` to be called with the global receiver; storing it
    // as a plain property and invoking it as a method triggers "Illegal
    // invocation", so it is bound to `globalThis` here.
    this.fetchImpl = (options.fetchImpl ?? fetch).bind(globalThis);
  }

  private nasaApiKey(): string | null {
    const key = this.env.NASA_API_KEY?.trim();
    return key ? key : null;
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "drone-radar-mobile/1.0",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchHazards(
    lat: number,
    lon: number,
    radiusKm: number,
    boxKey: string,
  ): Promise<HazardEvent[]> {
    const key = `nasa:hazards:${boxKey}`;
    const cached = await this.cache.get<HazardEvent[]>(key);
    if (cached) return cached;

    const pending = this.hazardInFlight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<HazardEvent[]> => {
      const box = buildBoundingBox(lat, lon, radiusKm);
      const url = new URL(EONET_URL);
      url.searchParams.set("status", "open");
      if (!box.global) {
        // EONET bbox order is west,south,east,north.
        url.searchParams.set(
          "bbox",
          [box.lomin, box.lamin, box.lomax, box.lamax]
            .map((v) => v.toFixed(3))
            .join(","),
        );
      }

      let payload: unknown;
      try {
        payload = await this.fetchJson(url);
      } catch (error) {
        this.lastHazardError =
          error instanceof Error && error.name === "AbortError"
            ? "EONET tardó demasiado en responder."
            : "No se pudo consultar EONET.";
        throw new Error(this.lastHazardError);
      }

      const events = (payload as { events?: unknown[] } | null)?.events ?? [];
      const hazards = events
        .map((event) => mapHazard(event, lat, lon, radiusKm))
        .filter((hazard): hazard is HazardEvent => hazard !== null)
        .sort((a, b) => b.observedAt - a.observedAt)
        .slice(0, MAX_HAZARDS);

      await this.cache.set(key, hazards, HAZARD_CACHE_TTL_SECONDS);
      this.seenBoxes.add(key);
      this.lastHazardError = null;
      return hazards;
    })();

    this.hazardInFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.hazardInFlight.delete(key);
    }
  }

  private async fetchSpaceWeather(): Promise<SpaceWeather> {
    const cached = await this.cache.get<{
      fetchedAt: number;
      value: SpaceWeather;
    }>("nasa:space-weather");
    if (cached) {
      this.spaceWeatherCachedAt = cached.fetchedAt;
      return cached.value;
    }
    if (this.spaceWeatherInFlight) return this.spaceWeatherInFlight;

    const request = (async (): Promise<SpaceWeather> => {
      const key = this.nasaApiKey();
      if (!key) {
        this.lastSpaceWeatherError =
          "Falta NASA_API_KEY en el servidor; el clima espacial no está disponible.";
        throw new Error(this.lastSpaceWeatherError);
      }

      const end = new Date();
      const start = new Date(
        end.getTime() - SPACE_WEATHER_LOOKBACK_DAYS * 86_400_000,
      );
      const url = new URL(DONKI_GST_URL);
      url.searchParams.set("startDate", isoDate(start));
      url.searchParams.set("endDate", isoDate(end));
      url.searchParams.set("api_key", key);

      let payload: unknown;
      try {
        payload = await this.fetchJson(url);
      } catch (error) {
        this.lastSpaceWeatherError =
          error instanceof Error && error.name === "AbortError"
            ? "DONKI tardó demasiado en responder."
            : "No se pudo consultar DONKI.";
        throw new Error(this.lastSpaceWeatherError);
      }

      const value = mapSpaceWeather(payload);
      const entry = { fetchedAt: Date.now(), value };
      await this.cache.set("nasa:space-weather", entry, SPACE_WEATHER_CACHE_TTL_SECONDS);
      this.spaceWeatherCachedAt = entry.fetchedAt;
      this.lastSpaceWeatherError = null;
      return value;
    })();

    this.spaceWeatherInFlight = request;
    try {
      return await request;
    } finally {
      this.spaceWeatherInFlight = null;
    }
  }

  async hazards(lat: number, lon: number, radiusKm: number): Promise<NasaHazards> {
    const radius = clamp(radiusKm, 1, MAX_RADIUS_KM);
    const box = buildBoundingBox(lat, lon, radius);
    const latDelta = radius / 111;
    const lonDelta = radius / (111 * Math.max(0.05, Math.cos(toRad(lat))));

    const hazards = await this.fetchHazards(lat, lon, radius, box.key);
    // The rounded bbox can include a margin; trim with the exact circle.
    const inRange = hazards.filter(
      (hazard) =>
        Math.abs(hazard.lat - lat) <= latDelta &&
        longitudeDelta(hazard.lon, lon) <= lonDelta &&
        haversineKm(lat, lon, hazard.lat, hazard.lon) <= radius,
    );

    return {
      fetchedAt: Date.now(),
      hazards: inRange.map((hazard) => ({
        ...hazard,
        distanceKm: haversineKm(lat, lon, hazard.lat, hazard.lon),
      })),
    };
  }

  async spaceWeather(): Promise<SpaceWeather> {
    return this.fetchSpaceWeather();
  }

  async health(): Promise<NasaHealth> {
    return {
      ok: true,
      sources: ["nasa-eonet", "nasa-donki"],
      hasApiKey: this.nasaApiKey() !== null,
      cachedBoxes: this.seenBoxes.size,
      spaceWeatherCachedAt: this.spaceWeatherCachedAt,
      lastHazardError: this.lastHazardError,
      lastSpaceWeatherError: this.lastSpaceWeatherError,
    };
  }
}
```

### `server/core/services.test.ts` — Pruebas del núcleo (14 casos)

```ts
import { describe, expect, it } from "vitest";

import { MemoryCacheStore } from "./cache";
import { buildBoundingBox, haversineKm } from "./geo";
import { RadarService } from "./radar-service";
import { NasaService, mapHazard, mapSpaceWeather } from "./nasa-service";

/** Stub for the external HTTP boundary; the service logic under test is real. */
function stubFetch(handler: (url: URL) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = handler(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const MADRID = { lat: 40.4, lon: -3.7 };

/** Builds an OpenSky state vector with sane defaults. */
function state(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const base: unknown[] = [
    "abc123",
    "IBE1234 ",
    "Spain",
    1_700_000_000,
    1_700_000_001,
    -3.7,
    40.4,
    10_000,
    false,
    250,
    90,
    0,
    null,
    10_000,
    "1234",
    false,
    0,
    2,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe("RadarService", () => {
  it("maps a valid state vector and converts units", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        states: [state()],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 100);
    expect(result.states).toHaveLength(1);
    const aircraft = result.states[0];
    expect(aircraft.icao).toBe("abc123");
    expect(aircraft.callsign).toBe("IBE1234");
    expect(aircraft.altFt).toBeCloseTo(32_808, 0);
    expect(aircraft.speedKt).toBeCloseTo(486, 0);
    expect(aircraft.category).toBe(2);
  });

  it("rejects on-ground, invalid-icao and out-of-range records", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        states: [
          state({ 8: true }), // on ground
          state({ 0: "NOTHEX" }), // bad icao
          state({ 6: 200 }), // latitude out of range
          state(),
        ],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 100);
    expect(result.states).toHaveLength(1);
  });

  it("drops aircraft outside the requested radius", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        // ~1 degree north is roughly 111 km away from Madrid.
        states: [state(), state({ 6: 41.4 })],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 50);
    expect(result.states).toHaveLength(1);
  });

  it("rejects a stale upstream sample as not live", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor((Date.now() - 60 * 60_000) / 1000),
        states: [state()],
      })),
    });

    await expect(service.states(MADRID.lat, MADRID.lon, 100)).rejects.toThrow(
      /vencida/,
    );
  });

  it("serves a second identical call from cache without refetching", async () => {
    let calls = 0;
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => {
        calls += 1;
        return { time: Math.floor(Date.now() / 1000), states: [state()] };
      }),
    });

    await service.states(MADRID.lat, MADRID.lon, 100);
    await service.states(MADRID.lat, MADRID.lon, 100);
    expect(calls).toBe(1);
  });
});

describe("NasaService", () => {
  const event = {
    id: "EONET_1",
    title: "Wildfire in Portugal",
    description: "desc",
    link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1",
    categories: [{ id: "wildfires", title: "Wildfires" }],
    geometry: [
      {
        date: "2026-11-10T00:00:00Z",
        type: "Point",
        coordinates: [-8.0, 39.5],
        magnitudeValue: 100,
        magnitudeUnit: "acres",
      },
    ],
  };

  it("maps a hazard inside the circle and computes its distance", async () => {
    const service = new NasaService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({ events: [event] })),
    });

    const result = await service.hazards(39.5, -8.0, 200);
    expect(result.hazards).toHaveLength(1);
    expect(result.hazards[0].categoryTitle).toBe("Wildfires");
    expect(result.hazards[0].distanceKm).toBeCloseTo(0, 3);
  });

  it("reports the highest Kp and flags GNSS risk at the threshold", () => {
    const now = Date.parse("2026-11-14T00:00:00Z");
    const value = mapSpaceWeather(
      [
        {
          allKpIndex: [
            { kpIndex: 3, observedTime: "2026-11-12T00:00:00Z" },
            { kpIndex: 6, observedTime: "2026-11-13T00:00:00Z" },
          ],
        },
      ],
      now,
    );

    expect(value.maxKpIndex).toBe(6);
    expect(value.gnssRisk).toBe(true);
    expect(value.samples).toHaveLength(2);
  });

  it("returns an empty space weather window instead of inventing values", () => {
    const value = mapSpaceWeather([], Date.now());
    expect(value.maxKpIndex).toBeNull();
    expect(value.observedAt).toBeNull();
    expect(value.gnssRisk).toBe(false);
  });

  it("fails the hazards request when EONET is unreachable", async () => {
    const service = new NasaService({
      cache: new MemoryCacheStore(),
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });

    await expect(service.hazards(39.5, -8.0, 200)).rejects.toThrow(
      /EONET/,
    );
  });
});

describe("mapHazard", () => {
  it("ignores geometry outside the radius and keeps the most recent inside", () => {
    const mapped = mapHazard(
      {
        id: "EONET_2",
        title: "Storm",
        categories: [{ id: "severeStorms", title: "Severe Storms" }],
        geometry: [
          { date: "2026-01-01T00:00:00Z", coordinates: [0, 0] },
          { date: "2026-02-01T00:00:00Z", coordinates: [-8.0, 39.5] },
          { date: "2026-03-01T00:00:00Z", coordinates: [10, 50] },
        ],
      },
      39.5,
      -8.0,
      200,
    );

    expect(mapped).not.toBeNull();
    expect(mapped?.lat).toBe(39.5);
    expect(mapped?.categoryId).toBe("severeStorms");
  });

  it("returns null for malformed events", () => {
    expect(mapHazard(null, 0, 0, 100)).toBeNull();
    expect(mapHazard({ id: "x" }, 0, 0, 100)).toBeNull();
  });
});

describe("geo helpers", () => {
  it("builds a bbox that contains the centre", () => {
    const box = buildBoundingBox(MADRID.lat, MADRID.lon, 100);
    expect(box.lamin).toBeLessThanOrEqual(MADRID.lat);
    expect(box.lamax).toBeGreaterThanOrEqual(MADRID.lat);
    expect(box.global).toBe(false);
  });

  it("falls back to a global band across the antimeridian", () => {
    const box = buildBoundingBox(0, 179.9, 100);
    expect(box.global).toBe(true);
    expect(box.lomin).toBe(-180);
    expect(box.lomax).toBe(180);
  });

  it("measures a known distance", () => {
    // Madrid to Lisbon is roughly 502 km.
    const distance = haversineKm(40.4168, -3.7038, 38.7223, -9.1393);
    expect(distance).toBeGreaterThan(490);
    expect(distance).toBeLessThan(515);
  });
});
```

### `worker/cache.ts` — Adaptador Cloudflare: caché (Cache API)

```ts
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
```

### `worker/index.ts` — Adaptador Cloudflare: enrutador del Worker

```ts
/**
 * Cloudflare Worker entry point for the Drone Radar API.
 *
 * This is a thin HTTP layer: every validation, caching and filtering rule is
 * shared with the Express server through `server/core/*`, so the deployed API
 * and the local dev API behave identically.
 */

import { parseCoordinate } from "../server/core/geo";
import { MAX_RADIUS_KM as RADAR_MAX_RADIUS_KM, RadarService } from "../server/core/radar-service";
import { MAX_RADIUS_KM as NASA_MAX_RADIUS_KM, NasaService } from "../server/core/nasa-service";
import { CloudflareCacheStore } from "./cache";

export interface Env {
  NASA_API_KEY?: string;
  OPENSKY_CLIENT_ID?: string;
  OPENSKY_CLIENT_SECRET?: string;
  /** Comma-separated list of allowed origins; "*" allows any. */
  ALLOWED_ORIGINS?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const configured = (env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowAny = configured.includes("*");
  const allowed =
    origin && (allowAny || configured.includes(origin)) ? origin : allowAny ? "*" : "";

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  extra: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extra },
  });
}

function readRadius(
  value: string | null,
  fallback: number,
): number | null {
  if (value === null) return fallback;
  return parseCoordinate(value);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "Método no permitido." }, 405, cors);
    }

    const radar = new RadarService({
      cache: new CloudflareCacheStore("radar"),
      env,
    });
    const nasa = new NasaService({
      cache: new CloudflareCacheStore("nasa"),
      env,
    });

    if (pathname === "/api/health") {
      return json({ ok: true, timestamp: Date.now() }, 200, cors);
    }

    if (pathname === "/api/radar/health") {
      return json(await radar.health(), 200, cors);
    }

    if (pathname === "/api/nasa/health") {
      return json(await nasa.health(), 200, cors);
    }

    if (pathname === "/api/radar/states") {
      const lat = parseCoordinate(url.searchParams.get("lat"));
      const lon = parseCoordinate(url.searchParams.get("lon"));
      const radiusKm = readRadius(url.searchParams.get("radiusKm"), 150);

      if (
        lat === null ||
        lon === null ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return json(
          {
            ok: false,
            error:
              "Coordenadas no válidas. Usa lat entre -90 y 90 y lon entre -180 y 180.",
          },
          400,
          cors,
        );
      }
      if (radiusKm === null) {
        return json(
          {
            ok: false,
            error: `Radio no válido. Usa un número de kilómetros entre 1 y ${RADAR_MAX_RADIUS_KM}.`,
          },
          400,
          cors,
        );
      }

      try {
        const result = await radar.states(lat, lon, radiusKm);
        return json(
          {
            ok: true,
            source: "opensky",
            fetchedAt: result.fetchedAt,
            sourceTimestamp: result.sourceTimestamp,
            sourceAgeMs: Math.max(0, Date.now() - result.sourceTimestamp),
            count: result.states.length,
            states: result.states,
          },
          200,
          cors,
        );
      } catch (error) {
        return json(
          {
            ok: false,
            source: "opensky",
            error:
              error instanceof Error
                ? error.message
                : "No se pudo consultar OpenSky.",
          },
          503,
          cors,
        );
      }
    }

    if (pathname === "/api/nasa/hazards") {
      const lat = parseCoordinate(url.searchParams.get("lat"));
      const lon = parseCoordinate(url.searchParams.get("lon"));
      const radiusKm = readRadius(url.searchParams.get("radiusKm"), 150);

      if (
        lat === null ||
        lon === null ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return json(
          {
            ok: false,
            error:
              "Coordenadas no válidas. Usa lat entre -90 y 90 y lon entre -180 y 180.",
          },
          400,
          cors,
        );
      }
      if (radiusKm === null) {
        return json(
          {
            ok: false,
            error: `Radio no válido. Usa un número de kilómetros entre 1 y ${NASA_MAX_RADIUS_KM}.`,
          },
          400,
          cors,
        );
      }

      try {
        const result = await nasa.hazards(lat, lon, radiusKm);
        return json(
          {
            ok: true,
            source: "nasa-eonet",
            fetchedAt: result.fetchedAt,
            count: result.hazards.length,
            hazards: result.hazards,
          },
          200,
          cors,
        );
      } catch (error) {
        return json(
          {
            ok: false,
            source: "nasa-eonet",
            error:
              error instanceof Error ? error.message : "No se pudo consultar EONET.",
          },
          503,
          cors,
        );
      }
    }

    if (pathname === "/api/nasa/space-weather") {
      try {
        const value = await nasa.spaceWeather();
        return json(
          { ok: true, source: "nasa-donki", fetchedAt: Date.now(), ...value },
          200,
          cors,
        );
      } catch (error) {
        return json(
          {
            ok: false,
            source: "nasa-donki",
            error:
              error instanceof Error ? error.message : "No se pudo consultar DONKI.",
          },
          503,
          cors,
        );
      }
    }

    return json({ ok: false, error: "Ruta no encontrada." }, 404, cors);
  },
};
```

### `wrangler.toml` — Configuración del Worker

```toml
name = "drone-radar-api"
main = "worker/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

# The API is a stateless proxy in front of OpenSky, NASA EONET and NASA DONKI.
# It stores nothing, so no D1/R2/KV binding is required: snapshots live in the
# Cloudflare Cache API (see worker/cache.ts).
workers_dev = true

[observability]
enabled = true

# Secrets are never committed. Set them once with:
#   wrangler secret put NASA_API_KEY
#   wrangler secret put OPENSKY_CLIENT_ID
#   wrangler secret put OPENSKY_CLIENT_SECRET
# Non-secret configuration lives in [vars]:
[vars]
ALLOWED_ORIGINS = "*"
```

### `.dev.vars.example` — Plantilla de secretos locales

```
# Copia este archivo a .dev.vars para el desarrollo local del Worker.
# .dev.vars está ignorado por git y nunca debe subirse.
#
#   cp .dev.vars.example .dev.vars
#
# NASA_API_KEY es necesaria para el clima espacial (DONKI).
# Las credenciales de OpenSky son opcionales (suben la cuota anónima).
NASA_API_KEY=
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
```

## 3. Archivos REEMPLAZADOS por completo (sobrescribir tal cual)

Estos archivos ya existen en el repositorio. **Sobrescríbelos enteros** con
el contenido siguiente.

### `server/radar.ts` — Adaptador Express del radar

```ts
/**
 * Express adapter for the radar API. All business logic lives in
 * `server/core/radar-service.ts`, which the Cloudflare Worker reuses.
 */

import type { Express, Request, Response } from "express";

import { MemoryCacheStore } from "./core/cache";
import { parseCoordinate } from "./core/geo";
import { MAX_RADIUS_KM, RadarService } from "./core/radar-service";

const service = new RadarService({
  cache: new MemoryCacheStore(),
  env: {
    OPENSKY_CLIENT_ID: process.env.OPENSKY_CLIENT_ID,
    OPENSKY_CLIENT_SECRET: process.env.OPENSKY_CLIENT_SECRET,
  },
});

export function registerRadarRoutes(app: Express): void {
  app.get("/api/radar/health", async (_req: Request, res: Response) => {
    res.json(await service.health());
  });

  app.get("/api/radar/states", async (req: Request, res: Response) => {
    const lat = parseCoordinate(req.query.lat);
    const lon = parseCoordinate(req.query.lon);
    const radiusKm =
      req.query.radiusKm === undefined
        ? 150
        : parseCoordinate(req.query.radiusKm);

    if (
      lat === null ||
      lon === null ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      res.status(400).json({
        ok: false,
        error: "Coordenadas no válidas. Usa lat entre -90 y 90 y lon entre -180 y 180.",
      });
      return;
    }

    if (radiusKm === null) {
      res.status(400).json({
        ok: false,
        error: `Radio no válido. Usa un número de kilómetros entre 1 y ${MAX_RADIUS_KM}.`,
      });
      return;
    }

    try {
      const result = await service.states(lat, lon, radiusKm);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        source: "opensky",
        fetchedAt: result.fetchedAt,
        sourceTimestamp: result.sourceTimestamp,
        sourceAgeMs: Math.max(0, Date.now() - result.sourceTimestamp),
        count: result.states.length,
        states: result.states,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo consultar OpenSky.";
      res.status(503).json({ ok: false, source: "opensky", error: message });
    }
  });
}
```

### `server/nasa.ts` — Adaptador Express de NASA

```ts
/**
 * Express adapter for the NASA API. All business logic lives in
 * `server/core/nasa-service.ts`, which the Cloudflare Worker reuses.
 */

import type { Express, Request, Response } from "express";

import { MemoryCacheStore } from "./core/cache";
import { parseCoordinate } from "./core/geo";
import { MAX_RADIUS_KM, NasaService } from "./core/nasa-service";

const service = new NasaService({
  cache: new MemoryCacheStore(),
  env: { NASA_API_KEY: process.env.NASA_API_KEY },
});

export function registerNasaRoutes(app: Express): void {
  app.get("/api/nasa/hazards", async (req: Request, res: Response) => {
    const lat = parseCoordinate(req.query.lat);
    const lon = parseCoordinate(req.query.lon);
    const radiusKm =
      req.query.radiusKm === undefined
        ? 150
        : parseCoordinate(req.query.radiusKm);

    if (
      lat === null ||
      lon === null ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      res.status(400).json({
        ok: false,
        error: "Coordenadas no válidas. Usa lat entre -90 y 90 y lon entre -180 y 180.",
      });
      return;
    }
    if (radiusKm === null) {
      res.status(400).json({
        ok: false,
        error: `Radio no válido. Usa un número de kilómetros entre 1 y ${MAX_RADIUS_KM}.`,
      });
      return;
    }

    try {
      const result = await service.hazards(lat, lon, radiusKm);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        source: "nasa-eonet",
        fetchedAt: result.fetchedAt,
        count: result.hazards.length,
        hazards: result.hazards,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo consultar EONET.";
      res.status(503).json({ ok: false, source: "nasa-eonet", error: message });
    }
  });

  app.get("/api/nasa/space-weather", async (_req: Request, res: Response) => {
    try {
      const value = await service.spaceWeather();
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, source: "nasa-donki", fetchedAt: Date.now(), ...value });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo consultar DONKI.";
      res.status(503).json({ ok: false, source: "nasa-donki", error: message });
    }
  });

  app.get("/api/nasa/health", async (_req: Request, res: Response) => {
    res.json(await service.health());
  });
}
```

### `README.md` — Documentación

````
# Drone Radar

Estación táctica de bolsillo para vigilar el tráfico aéreo cercano. La app
convierte los datos ADS-B abiertos de **OpenSky Network** en un radar circular
centrado en tu posición, y los complementa con dos fuentes de datos abiertos de
la **NASA**: eventos naturales geolocalizados (EONET) y clima espacial (DONKI).

No hay simulación, ni datos sintéticos, ni valores de relleno: si una fuente no
responde, la app lo dice y no inventa contactos.

## Qué hace

- **Radar táctico** con anillos de alcance, rosa de los vientos, barrido animado y
  blips ubicados por rumbo y distancia respecto a tu estación.
- **Contactos ADS-B reales** de OpenSky, con ICAO24, altitud, velocidad, rumbo y
  distancia; lista ordenada por cercanía y ficha al tocar un blip.
- **Alertas** de proximidad, reversión de trayectoria (>150° con ≥30 kt), posibles
  UAS según indicios ADS-B y eventos de sistema.
- **Eventos naturales** (NASA EONET): incendios, tormentas y volcanes cercanos,
  superpuestos en el radar y listados por distancia.
- **Clima espacial** (NASA DONKI): índice Kp máximo reciente y aviso de posible
  degradación GNSS.
- **Orientación** Norte arriba o Rumbo arriba (con GPS en primer plano).
- **Ajustes persistentes**: estación, alcance, umbral de proximidad, filtros y
  orientación.

## Arquitectura

```
Expo Router (app/)
  (tabs)/index      Radar táctico + eventos NASA
  (tabs)/contacts   Lista y búsqueda de contactos
  (tabs)/alerts     Registro de alertas
  (tabs)/nasa       EONET + DONKI
  (tabs)/settings   Estación, alcance, filtros, orientación

RadarProvider (lib/radar/store.tsx)
  ajustes + AsyncStorage
  polling OpenSky (60 s), actualización manual y reintento
  feed NASA independiente (EONET + DONKI)

Servidor Express (server/)
  GET /api/radar/states          proxy OpenSky + caché 30 s
  GET /api/radar/health
  GET /api/nasa/hazards          proxy EONET + caché 10 min
  GET /api/nasa/space-weather    proxy DONKI + caché 30 min
  GET /api/nasa/health
  GET /api/health
```

### Producción en Cloudflare

El mismo API corre en **Cloudflare Workers** con los endpoints idénticos, y el
frontend web se sirve como estáticos en **Cloudflare Pages**. La lógica no está
duplicada: vive en `server/core/` y ambos entornos la consumen a través de
adaptadores finos.

```
                      ┌──────────────────────────────┐
  Expo web (Pages) ──►│  Worker  worker/index.ts     │
  Expo nativo ───────►│  (router + CORS + JSON)      │
                      └──────────────┬───────────────┘
                                     │ usa
                      ┌──────────────▼───────────────┐
                      │  Núcleo  server/core/*       │
                      │  radar-service  nasa-service │
                      │  geo            cache        │
                      └──────────────┬───────────────┘
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
          OpenSky               NASA EONET             NASA DONKI

  Express (server/radar.ts, server/nasa.ts) usa el MISMO núcleo
  con MemoryCacheStore en lugar de la Cache API.
```

La única diferencia real entre ambos entornos es la caché:

| Entorno | Implementación de `CacheStore` | Motivo |
| --- | --- | --- |
| Express local | `MemoryCacheStore` (`Map`) | Un solo proceso persistente |
| Cloudflare Worker | `CloudflareCacheStore` (`caches.default`) | Un `Map` no sobrevive entre invocaciones |

### Flujo de datos

1. `RadarProvider` arranca en `connecting` y consulta únicamente OpenSky.
2. El cliente pide `GET /api/radar/states` con latitud, longitud y radio.
3. El servidor consulta OpenSky, normaliza cada vector de estado y cachea 30 s por
   caja geográfica (bbox).
4. El servidor exige muestra reciente (máx. 5 min), ICAO24 hexadecimal de 6
   caracteres y coordenadas válidas; el cliente vuelve a comprobar fuente y
   frescura antes de marcar la respuesta como real.
5. Una respuesta fresca, incluso con cero aeronaves, confirma `live`. Un resultado
   vacío se muestra con cero contactos y ningún blip.
6. Si falla la red, la validación u OpenSky, se limpian los contactos, se muestra
   el error y se permite reintentar. Nunca se generan contactos simulados.
7. Los eventos NASA (EONET/DONKI) van por un feed **independiente**: una caída de
   NASA no borra los contactos ADS-B, y una caída de OpenSky no borra los eventos
   NASA.

### Requisitos previos

- **Node.js 20+** y **pnpm**.
- No se necesita ninguna clave para funcionar en modo básico: OpenSky tiene
  acceso anónimo (cuota reducida) y EONET es de dominio público.

## Puesta en marcha

```bash
pnpm install

# Variables de entorno (todas opcionales en local)
cp .env.example .env
# NASA_API_KEY=...            # solo para DONKI (clima espacial)
# OPENSKY_CLIENT_ID=...       # opcional, sube la cuota de OpenSky
# OPENSKY_CLIENT_SECRET=...

pnpm dev            # API (3000) + Metro web (8081)
```

Para trabajar por separado:

```bash
pnpm dev:server     # API en http://localhost:3000
pnpm dev:metro      # Metro web en http://localhost:8081
```

En web local, Metro no puede deducir la URL del API a partir del host, así que
exporta la base antes de arrancar Metro:

```bash
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 pnpm dev:metro --clear
```

## Scripts

| Script | Qué hace |
| --- | --- |
| `pnpm dev` | API + Metro web a la vez |
| `pnpm dev:server` | Servidor Express en 3000 |
| `pnpm dev:metro` | Metro web en 8081 |
| `pnpm check` | Typecheck (`tsc --noEmit`) |
| `pnpm lint` | ESLint (`expo lint`) |
| `pnpm test` | Pruebas unitarias (vitest) |
| `pnpm format` | Prettier |
| `pnpm build` | Empaqueta el servidor con esbuild |
| `pnpm start` | Arranca el servidor empaquetado |
| `pnpm worker:dev` | Worker en local (`wrangler dev`, puerto 8787) |
| `pnpm worker:deploy` | Despliega el Worker en Cloudflare |
| `pnpm worker:types` | Genera tipos de bindings de Cloudflare |

## Despliegue en Cloudflare

El backend es un Worker sin estado: no guarda nada y no necesita D1, R2 ni KV.
Las instantáneas viven en la Cache API de Cloudflare.

### 1. Token de API

Crea un token en el panel de Cloudflare con la plantilla **Edit Cloudflare
Workers** (permisos `Workers Scripts: Edit` y `Account Settings: Read`).
Comprueba que es válido antes de desplegar:

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
```

### 2. Secretos (nunca en el repositorio)

```bash
pnpm exec wrangler secret put NASA_API_KEY
pnpm exec wrangler secret put OPENSKY_CLIENT_ID        # opcional
pnpm exec wrangler secret put OPENSKY_CLIENT_SECRET    # opcional
```

En local, los secretos van en `.dev.vars` (ya ignorado por git):

```
NASA_API_KEY=...
```

### 3. Desplegar

```bash
pnpm worker:deploy
```

La API queda en `https://drone-radar-api.<tu-subdominio>.workers.dev`.

### 4. Frontend web en Pages

```bash
EXPO_PUBLIC_API_BASE_URL="https://drone-radar-api.<tu-subdominio>.workers.dev" \
  npx expo export --platform web --output-dir dist-web
```

Sube `dist-web/` como proyecto de Pages (o conecta el repositorio y usa ese
comando como build). La variable `EXPO_PUBLIC_API_BASE_URL` se incrusta en el
bundle en tiempo de compilación, así que debe estar definida al exportar.

### 5. Integración continua

`.github/workflows/ci.yml` verifica tipos, lint, pruebas y un `wrangler deploy
--dry-run` en cada push y pull request. El job de despliegue solo se ejecuta en
`main` y **solo si existe el secreto `CLOUDFLARE_API_TOKEN`**; sin él, se omite
y la pipeline sigue verde.

## Estructura del proyecto

- `app/_layout.tsx`: fuentes, proveedor global, tema y stack.
- `app/(tabs)/`: las cinco pestañas (radar, contactos, alertas, NASA, ajustes).
- `lib/radar/`: estado, persistencia, polling, alertas y geolocalización.
  - `geo.ts` haversine, rumbo, destino y formato.
  - `store.tsx` estado, polling OpenSky, feed NASA y watcher de curso GPS.
- `lib/nasa/`: cliente, parseo y vista de EONET/DONKI.
- `components/radar/RadarScope.tsx`: SVG del radar, rosa, blips y eventos.
- `components/hud.tsx`: paneles, chips, métricas y botones del HUD.
- `server/core/`: lógica compartida (radar, NASA, geo, caché); no depende de Express ni de Cloudflare.
- `server/`: adaptador Express (OpenSky, NASA) sobre `server/core/`.
- `worker/`: adaptador Cloudflare Workers (`index.ts` enrutador, `cache.ts` Cache API).
- `wrangler.toml`: configuración del Worker.
- `tests/` y `lib/**/*.test.ts`: pruebas unitarias.

## Fuentes de datos

| Fuente | Qué aporta | Clave | Caché servidor |
| --- | --- | --- | --- |
| [OpenSky Network](https://openskynetwork.github.io/opensky-api/) | Tráfico ADS-B en tiempo real | Opcional (OAuth2) | 30 s |
| [NASA EONET](https://eonet.gsfc.nasa.gov/) | Eventos naturales geolocalizados | No | 10 min |
| [NASA DONKI](https://api.nasa.gov/) | Clima espacial (Kp) | Sí (`NASA_API_KEY`) | 30 min |

## Límites honestos

- **Los drones pequeños no emiten ADS-B.** La mayoría de sUAS civiles no
  transmiten por ADS-B, así que un radar basado en OpenSky ve sobre todo
  aeronaves grandes y comerciales. Un radar de drones de baja altitud requeriría
  Remote ID o telemetría directa, que este proyecto no cubre.
- **Los datos ADS-B pueden estar incompletos** o llegar con retraso. La app lo
  advierte y nunca rellena huecos con datos inventados.
- **El clima espacial (DONKI)** puede no reportar actividad reciente; en ese caso
  la app muestra «sin datos» en lugar de un valor por defecto.
- **Los eventos de EONET** pueden estar a cientos de kilómetros; con un alcance
  reducido es normal que no aparezca ninguno cerca.
- **No usar para navegación ni seguridad aérea.**

## Licencia

MIT. Ver [LICENSE](LICENSE).
````

### `.gitignore` — Ignora artefactos y secretos del Worker

```
# Learn more https://docs.github.com/en/get-started/getting-started-with-git/ignoring-files

# dependencies
node_modules/
.pnpm-store/
*.manus-starter-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]

# Expo
.expo/
dist/
dist-web/
dist-worker/
web-build/
expo-env.d.ts

# Native
.kotlin/
*.orig.*
*.jks
*.p8
*.p12
*.key
*.mobileprovision

# Metro
.metro-health-check*

# debug
npm-debug.*
yarn-debug.*
yarn-error.*

# macOS
.DS_Store
*.pem

# local env files
.env
.env.*
!.env.example
.env*.local

# typescript
*.tsbuildinfo

app-example

# generated native folders
/ios
/android

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
logs
*.log

# OS
Thumbs.db

# Build files
*.tgz
*.tar.gz
.cache/

# Webdev artifacts (checkpoint zips, migrations, etc.)
.webdev/

# Agent workspace (memoria local del agente, no es código del proyecto)
.openhands/

# Source archive used during scaffolding; the real tree is tracked instead.
code.zip

# Cloudflare Worker local secrets (contains API keys)
.dev.vars
.wrangler/
```

### `package.json` — Scripts y dependencia wrangler

```json
{
  "name": "drone-radar",
  "version": "1.0.0",
  "private": true,
  "description": "Radar táctico ADS-B (OpenSky) con eventos naturales y clima espacial de la NASA (EONET/DONKI).",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/ruben12n11-a11y/Dron.git"
  },
  "main": "expo-router/entry",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "concurrently -k \"pnpm dev:server\" \"pnpm dev:metro\"",
    "dev:server": "cross-env PORT=3000 NODE_ENV=development tsx watch server/_core/index.ts",
    "worker:dev": "wrangler dev",
    "worker:deploy": "wrangler deploy",
    "worker:types": "wrangler types",
    "dev:metro": "cross-env EXPO_USE_METRO_WORKSPACE_ROOT=1 EXPO_PORT=8081 npx expo start --web --port 8081",
    "build": "esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js",
    "check": "tsc --noEmit",
    "lint": "expo lint",
    "format": "prettier --write .",
    "test": "vitest run",
    "db:push": "drizzle-kit generate && drizzle-kit migrate",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "qr": "node scripts/generate_qr.mjs"
  },
  "dependencies": {
    "@expo/metro-runtime": "~57.0.16",
    "@expo/vector-icons": "^15.0.2",
    "@react-native-async-storage/async-storage": "2.2.0",
    "@tanstack/react-query": "^5.90.12",
    "@trpc/client": "11.7.2",
    "@trpc/react-query": "11.7.2",
    "@trpc/server": "11.7.2",
    "axios": "^1.13.2",
    "clsx": "^2.1.1",
    "cookie": "^1.1.1",
    "dotenv": "^16.6.1",
    "drizzle-orm": "^0.44.7",
    "expo": "~57.0.24",
    "expo-asset": "~57.0.18",
    "expo-audio": "~57.0.5",
    "expo-build-properties": "~57.0.21",
    "expo-constants": "~57.0.19",
    "expo-font": "~57.0.4",
    "expo-haptics": "~57.0.3",
    "expo-image": "~57.0.5",
    "expo-keep-awake": "~57.0.2",
    "expo-linking": "~57.0.10",
    "expo-location": "~57.0.23",
    "expo-notifications": "~57.0.20",
    "expo-router": "~57.0.22",
    "expo-secure-store": "~57.0.4",
    "expo-splash-screen": "~57.0.9",
    "expo-status-bar": "~57.0.1",
    "expo-symbols": "~57.0.3",
    "expo-system-ui": "~57.0.4",
    "expo-video": "~57.0.4",
    "expo-web-browser": "~57.0.3",
    "express": "^4.22.1",
    "jose": "6.1.0",
    "mysql2": "^3.16.0",
    "nativewind": "^4.2.1",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-gesture-handler": "~2.32.0",
    "react-native-reanimated": "4.5.1",
    "react-native-safe-area-context": "~5.7.0",
    "react-native-screens": "~4.26.0",
    "react-native-svg": "15.15.4",
    "react-native-web": "~0.21.0",
    "react-native-worklets": "0.10.1",
    "superjson": "^1.13.3",
    "tailwind-merge": "^2.6.0",
    "zod": "^4.2.1"
  },
  "devDependencies": {
    "@expo/ngrok": "^4.1.3",
    "@types/cookie": "^0.6.0",
    "@types/express": "^4.17.25",
    "@types/node": "^22.19.3",
    "@types/qrcode": "^1.5.6",
    "@types/react": "~19.2.18",
    "concurrently": "^9.2.1",
    "cross-env": "^7.0.3",
    "drizzle-kit": "^0.31.8",
    "esbuild": "^0.25.12",
    "eslint": "^9.39.2",
    "eslint-config-expo": "~57.0.2",
    "prettier": "^3.7.4",
    "qrcode": "^1.5.4",
    "tailwindcss": "^3.4.17",
    "tsx": "^4.21.0",
    "typescript": "~6.0.3",
    "vitest": "^2.1.9",
    "wrangler": "^4.162.0"
  },
  "packageManager": "pnpm@9.12.0",
  "pnpm": {
    "onlyBuiltDependencies": [
      "esbuild",
      "unrs-resolver"
    ]
  }
}
```

### `.github/workflows/ci.yml` — CI: dry-run + despliegue condicionado

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    name: Typecheck, lint y pruebas
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Instalar pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - name: Instalar Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Instalar dependencias
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm check

      - name: Lint
        run: pnpm lint

      - name: Pruebas
        run: pnpm test

      - name: Verificar el Worker (dry-run)
        run: pnpm exec wrangler deploy --dry-run --outdir dist-worker

  deploy:
    name: Desplegar API (Cloudflare Workers)
    needs: verify
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      # Secrets cannot be read directly in an `if`, so it is surfaced as a
      # job-level environment variable and the step checks that instead.
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Instalar pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9.12.0

      - name: Instalar Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Instalar dependencias
        run: pnpm install --frozen-lockfile

      # Skipped when the repository secret is absent, so the pipeline stays
      # green before Cloudflare is connected.
      - name: Desplegar
        if: env.CLOUDFLARE_API_TOKEN != ''
        run: pnpm exec wrangler deploy
```

## 4. Archivo MOVIDO

`server/geo.ts` pasa a `server/core/geo.ts`:

```bash
git mv server/geo.ts server/core/geo.ts
```

Si no usas git: crea `server/core/geo.ts` con el contenido de la sección 2 y
borra `server/geo.ts`. Las importaciones nuevas ya apuntan a `./core/geo`.

## 5. Dependencias

`package.json` ya incluye `wrangler` en `devDependencies`. Regenera el
lockfile e instala:

```bash
pnpm install
```

Esto actualiza `pnpm-lock.yaml` con wrangler v4. **No edites el lockfile a
mano.**

## 6. Verificación (criterios de aceptación)

```bash
pnpm install
pnpm check     # tsc --noEmit sin errores
pnpm lint      # expo lint sin errores
pnpm test      # 59 pasan, 1 omitida (6 archivos)
pnpm exec wrangler deploy --dry-run --outdir dist-worker   # compila
```

Prueba funcional del Worker en local (requiere `NASA_API_KEY` en `.dev.vars`):

```bash
cp .dev.vars.example .dev.vars   # rellena NASA_API_KEY
pnpm worker:dev                  # escucha en http://localhost:8787

curl -s "http://localhost:8787/api/nasa/hazards?lat=39.5&lon=-8.0&radiusKm=200"
# Esperado: {"ok":true,"source":"nasa-eonet","count":N>0,...}

curl -s "http://localhost:8787/api/nasa/space-weather"
# Esperado: {"ok":true,"source":"nasa-donki",...}

curl -s "http://localhost:8787/api/nasa/health"
# Esperado: {"ok":true,"hasApiKey":true,...}
```

Paridad: Express (`pnpm dev:server`, puerto 3000) y el Worker deben devolver
**el mismo resultado** para la misma consulta.

## 7. Trampas conocidas (no las repitas)

1. **`Illegal invocation`.** En Workers, guardar `fetch` como propiedad de
   clase y llamarlo como método rompe. La solución ya está aplicada:
   `this.fetchImpl = (options.fetchImpl ?? fetch).bind(globalThis);`
2. **`caches.default` no está en los tipos DOM.** No añadas
   `@cloudflare/workers-types` (choca con el `tsconfig` de Expo). Se accede
   con un cast estrecho, como en `worker/cache.ts`.
3. **Un `Map` en módulo NO persiste** entre invocaciones del Worker.
4. **Wrangler v3 está obsoleto**; usa v4 (`^4.162.0`).
5. **Nunca subas `.dev.vars`.** Está ignorado por git; la plantilla es
   `.dev.vars.example`.
6. **OpenSky puede no ser alcanzable** desde algunas redes (timeout). No es un
   fallo del código: EONET y DONKI sí responden.

## 8. Resumen de cambios

| Acción | Ruta |
| --- | --- |
| Crear | `server/core/cache.ts` |
| Crear | `server/core/geo.ts` |
| Crear | `server/core/radar-service.ts` |
| Crear | `server/core/nasa-service.ts` |
| Crear | `server/core/services.test.ts` |
| Crear | `worker/cache.ts` |
| Crear | `worker/index.ts` |
| Crear | `wrangler.toml` |
| Crear | `.dev.vars.example` |
| Reemplazar | `server/radar.ts` |
| Reemplazar | `server/nasa.ts` |
| Reemplazar | `README.md` |
| Reemplazar | `.gitignore` |
| Reemplazar | `package.json` |
| Reemplazar | `.github/workflows/ci.yml` |
| Mover | `server/geo.ts` → `server/core/geo.ts` |
| Regenerar | `pnpm-lock.yaml` (con `pnpm install`) |
