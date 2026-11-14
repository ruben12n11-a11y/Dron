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
