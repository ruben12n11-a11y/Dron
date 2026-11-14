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
