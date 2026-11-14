import type { Express, Request, Response } from "express";

import {
  buildBoundingBox,
  clamp,
  haversineKm,
  longitudeDelta,
  numeric,
  parseCoordinate,
  toRad,
  type BoundingBox,
} from "./geo";

const OPENSKY_URL = "https://opensky-network.org/api/states/all";
const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_SOURCE_AGE_MS = 5 * 60_000;
const MAX_RADIUS_KM = 250;
const MAX_RESULTS = 150;
const RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;
const ERROR_COOLDOWN_MS = 2 * 60_000;

const METERS_TO_FEET = 3.28084;
const MPS_TO_KNOTS = 1.943844;
const MPS_TO_FPM = 196.8504;

interface ServerAircraft {
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

interface AircraftCache {
  fetchedAt: number;
  sourceTimestamp: number;
  aircraft: ServerAircraft[];
}

// Cache is keyed by a rounded bounding box so nearby stations share a fetch.
const cache = new Map<string, AircraftCache>();
const inFlight = new Map<string, Promise<AircraftCache>>();
let lastCacheKey: string | null = null;
let cooldownUntil = 0;
let lastError: string | null = null;

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(TOKEN_URL, {
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
    tokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 1800) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mapAircraft(state: unknown): ServerAircraft | null {
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

async function fetchOpenSky(box: BoundingBox): Promise<AircraftCache> {
  const cached = cache.get(box.key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    lastCacheKey = box.key;
    return cached;
  }

  if (Date.now() < cooldownUntil) {
    throw new Error(
      lastError ??
        "OpenSky está limitando las consultas. No se mostrarán contactos hasta que el enlace se recupere.",
    );
  }

  const pending = inFlight.get(box.key);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const token = await getAccessToken();
      const url = new URL(OPENSKY_URL);
      if (!box.global) {
        url.searchParams.set("lamin", box.lamin.toFixed(3));
        url.searchParams.set("lomin", box.lomin.toFixed(3));
        url.searchParams.set("lamax", box.lamax.toFixed(3));
        url.searchParams.set("lomax", box.lomax.toFixed(3));
      }

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "drone-radar-mobile/1.0",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });

      if (response.status === 429) {
        cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        lastError = "OpenSky alcanzó el límite de consultas. Espera al siguiente intento o configura credenciales OAuth.";
        throw new Error(lastError);
      }
      if (response.status === 401 || response.status === 403) {
        cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        lastError =
          "OpenSky rechazó la consulta. Define OPENSKY_CLIENT_ID y OPENSKY_CLIENT_SECRET para usar una cuenta autenticada.";
        throw new Error(lastError);
      }
      if (!response.ok) {
        cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
        lastError = `OpenSky respondió ${response.status}.`;
        throw new Error(lastError);
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
        cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
        throw new Error("La muestra de OpenSky está vencida; se rechaza como dato en vivo.");
      }
      const aircraft = (payload.states ?? [])
        .map(mapAircraft)
        .filter((item): item is ServerAircraft => item !== null);

      const snapshot: AircraftCache = {
        // Use local fetch time for TTL. OpenSky's snapshot timestamp can lag,
        // which would otherwise make a fresh cache look expired immediately.
        fetchedAt: Date.now(),
        sourceTimestamp,
        aircraft,
      };
      cache.set(box.key, snapshot);
      lastCacheKey = box.key;
      for (const [key, value] of cache) {
        if (Date.now() - value.fetchedAt > CACHE_TTL_MS * 4) {
          cache.delete(key);
        }
      }
      lastError = null;
      cooldownUntil = 0;
      return snapshot;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = "OpenSky tardó demasiado en responder.";
      } else if (error instanceof Error && error.message) {
        lastError = error.message;
      } else {
        lastError = "No se pudo consultar OpenSky.";
      }
      throw new Error(lastError);
    } finally {
      clearTimeout(timeout);
    }
  })();

  inFlight.set(box.key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(box.key);
  }
}

export function registerRadarRoutes(app: Express): void {
  app.get("/api/radar/health", (_req: Request, res: Response) => {
    const latest = lastCacheKey ? cache.get(lastCacheKey) : undefined;
    res.json({
      ok: true,
      source: "opensky",
      cacheAgeMs: latest ? Date.now() - latest.fetchedAt : null,
      sourceTimestamp: latest?.sourceTimestamp ?? null,
      sourceAgeMs: latest ? Math.max(0, Date.now() - latest.sourceTimestamp) : null,
      fresh: latest
        ? Date.now() - latest.sourceTimestamp <= MAX_SOURCE_AGE_MS
        : false,
      cachedBoxes: cache.size,
      cooldownUntil: cooldownUntil || null,
    });
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
        error: "Radio no válido. Usa un número de kilómetros entre 1 y 250.",
      });
      return;
    }

    const radius = clamp(radiusKm, 1, MAX_RADIUS_KM);
    const box = buildBoundingBox(lat, lon, radius);
    const latDelta = radius / 111;
    const lonDelta = radius / (111 * Math.max(0.05, Math.cos(toRad(lat))));

    try {
      const snapshot = await fetchOpenSky(box);
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

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        source: "opensky",
        fetchedAt: snapshot.fetchedAt,
        sourceTimestamp: snapshot.sourceTimestamp,
        sourceAgeMs: Math.max(0, Date.now() - snapshot.sourceTimestamp),
        count: states.length,
        states,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo consultar OpenSky.";
      res.status(503).json({
        ok: false,
        source: "opensky",
        error: message,
      });
    }
  });
}
