import { angleDiffDeg, bearingDeg, haversineM } from "./geo";
import type { PositionSample } from "./types";

/**
 * ADS-B does not carry a reliable "drone" flag. These callsign/ICAO/category
 * hints mirror the heuristic used by the original Python detector.
 */
export const DRONE_HINTS = [
  "DRONE",
  "UAV",
  "UAS",
  "QUAD",
  "MULTI",
  "HEXA",
  "COPTER",
  "PARASAIL",
  "AIRSHIP",
  "BALLOON",
  "ULTRALIGHT",
  "ULM",
  "FPV",
  "BVLOS",
] as const;

export function isUasHint(
  callsign: string,
  icao: string,
  category: string | null,
): boolean {
  const haystack = `${callsign} ${icao} ${category ?? ""}`.toUpperCase();
  return DRONE_HINTS.some((hint) => haystack.includes(hint));
}

/**
 * Trajectory reversal: largest angle between consecutive movement vectors
 * in the last four samples. Using a four-sample window keeps the reversal
 * visible even when the vertex sample lands close to its predecessor.
 */
export function computeTurnDeg(samples: PositionSample[]): number {
  if (samples.length < 3) return 0;
  const recent = samples.slice(-4);
  let maxTurn = 0;

  for (let index = 2; index < recent.length; index += 1) {
    const a = recent[index - 2];
    const b = recent[index - 1];
    const c = recent[index];
    // Skip zero-length segments (GPS jitter / stationary contacts). The
    // turn alert itself also requires >= 30 kt, so noise cannot trigger it.
    if (
      haversineM(a.lat, a.lon, b.lat, b.lon) < 1 ||
      haversineM(b.lat, b.lon, c.lat, c.lon) < 1
    ) {
      continue;
    }
    const firstHeading = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    const secondHeading = bearingDeg(b.lat, b.lon, c.lat, c.lon);
    maxTurn = Math.max(maxTurn, angleDiffDeg(firstHeading, secondHeading));
  }

  return maxTurn;
}

const CATEGORY_LABELS: Record<number, string> = {
  0: "Sin categoría",
  1: "Ligera",
  2: "Pequeña",
  3: "Grande",
  4: "Alta estela",
  5: "Pesada",
  6: "Alta prestación",
  7: "Rotorcraft",
  8: "Planeador",
  9: "Aerostato",
  10: "Paracaidista",
  11: "Ultraligero",
  12: "Reservada",
  13: "UAV",
  14: "Espacio",
  15: "Emergencia",
  16: "Servicio",
};

/** Normalizes the numeric ADS-B emitter category returned by OpenSky. */
export function categoryLabel(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  return CATEGORY_LABELS[value] ?? `Cat. ${value}`;
}
