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
