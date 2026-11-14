import { resolveApiBase } from "@/lib/api-base";

import { categoryLabel, isUasHint } from "./detection";
import type { RadarContact } from "./types";

const MAX_SOURCE_AGE_MS = 5 * 60_000;

export interface OpenSkyStateDto {
  icao: string;
  callsign: string;
  lat: number;
  lon: number;
  altFt: number;
  speedKt: number;
  headingDeg: number;
  verticalRateFpm?: number;
  category?: number | string | null;
}

export interface LiveFetchResult {
  contacts: RadarContact[];
  fetchedAt: number;
  /** Upstream OpenSky snapshot timestamp in epoch milliseconds. */
  sourceTimestamp: number;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toContact(state: OpenSkyStateDto): RadarContact | null {
  const lat = finiteNumber(state.lat);
  const lon = finiteNumber(state.lon);
  const altFt = finiteNumber(state.altFt);
  const speedKt = finiteNumber(state.speedKt);
  const headingDeg = finiteNumber(state.headingDeg);

  if (
    !/^[0-9a-f]{6}$/i.test(state.icao) ||
    lat === null ||
    lat < -90 ||
    lat > 90 ||
    lon === null ||
    lon < -180 ||
    lon > 180 ||
    altFt === null
  ) {
    return null;
  }

  const callsign = (state.callsign || state.icao || "").trim();
  const category = categoryLabel(state.category);
  const uas = isUasHint(callsign, state.icao, category);

  return {
    id: `live:${state.icao}`,
    callsign: callsign || state.icao,
    icao: state.icao,
    lat,
    lon,
    altFt,
    speedKt: speedKt ?? 0,
    headingDeg: headingDeg ?? 0,
    verticalRateFpm: finiteNumber(state.verticalRateFpm) ?? 0,
    category,
    kind: uas ? "drone" : "aircraft",
    uas,
    source: "opensky",
    lastSeen: Date.now(),
  };
}

export async function fetchOpenSkyContacts(params: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<LiveFetchResult> {
  const base = resolveApiBase();
  const query = new URLSearchParams({
    lat: params.lat.toFixed(5),
    lon: params.lon.toFixed(5),
    radiusKm: String(Math.round(params.radiusKm)),
  });
  const url = `${base}/api/radar/states?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const raw = await response.text();

    let payload: {
      ok?: boolean;
      error?: string;
      source?: string;
      fetchedAt?: number;
      sourceTimestamp?: number;
      states?: OpenSkyStateDto[];
    };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `El servidor respondió ${response.status}.`);
    }

    const sourceTimestamp = finiteNumber(payload.sourceTimestamp);
    if (payload.source !== "opensky" || sourceTimestamp === null) {
      throw new Error("La respuesta no acredita una muestra de OpenSky.");
    }
    const sourceAgeMs = Date.now() - sourceTimestamp;
    if (sourceAgeMs < -60_000 || sourceAgeMs > MAX_SOURCE_AGE_MS) {
      throw new Error("La muestra ADS-B de OpenSky no es reciente.");
    }

    const contacts = (payload.states ?? [])
      .map(toContact)
      .filter((contact): contact is RadarContact => contact !== null);

    return {
      contacts,
      sourceTimestamp,
      fetchedAt:
        typeof payload.fetchedAt === "number" ? payload.fetchedAt : Date.now(),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenSky tardó demasiado en responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
