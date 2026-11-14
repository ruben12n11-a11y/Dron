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
