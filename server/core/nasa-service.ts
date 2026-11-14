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
