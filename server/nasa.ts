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
