import { resolveApiBase } from "@/lib/api-base";

import { sanitizeSpaceWeather, toHazard } from "./parse";
import type {
  HazardDto,
  HazardFetchResult,
  SpaceWeatherFetchResult,
} from "./types";

const REQUEST_TIMEOUT_MS = 20_000;

async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const raw = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("El servidor devolvió una respuesta no válida.");
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : `El servidor respondió ${response.status}.`;
      throw new Error(message);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("La consulta a NASA tardó demasiado en responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHazards(params: {
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<HazardFetchResult> {
  const base = resolveApiBase();
  const query = new URLSearchParams({
    lat: params.lat.toFixed(5),
    lon: params.lon.toFixed(5),
    radiusKm: String(Math.round(params.radiusKm)),
  });
  const payload = (await requestJson(
    `${base}/api/nasa/hazards?${query.toString()}`,
  )) as {
    ok?: boolean;
    source?: string;
    fetchedAt?: number;
    hazards?: HazardDto[];
  };

  if (payload?.source !== "nasa-eonet") {
    throw new Error("La respuesta no acredita datos de NASA EONET.");
  }

  const hazards = (payload.hazards ?? [])
    .map((dto) => toHazard(dto, params.lat, params.lon))
    .filter((hazard): hazard is NonNullable<typeof hazard> => hazard !== null)
    .sort((a, b) => a.distanceM - b.distanceM);

  return {
    hazards,
    fetchedAt: typeof payload.fetchedAt === "number" ? payload.fetchedAt : Date.now(),
  };
}

export async function fetchSpaceWeather(): Promise<SpaceWeatherFetchResult> {
  const base = resolveApiBase();
  const payload = (await requestJson(`${base}/api/nasa/space-weather`)) as {
    ok?: boolean;
    source?: string;
    fetchedAt?: number;
  } & Record<string, unknown>;

  if (payload?.source !== "nasa-donki") {
    throw new Error("La respuesta no acredita datos de NASA DONKI.");
  }

  return {
    weather: sanitizeSpaceWeather(payload),
    fetchedAt: typeof payload.fetchedAt === "number" ? payload.fetchedAt : Date.now(),
  };
}
