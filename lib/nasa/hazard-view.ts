import { bearingDeg, haversineM } from "../radar/geo";

import type { HazardEvent } from "./types";

export interface HazardView extends HazardEvent {
  bearingDeg: number;
  isNear: boolean;
  isVisible: boolean;
}

/**
 * Places a hazard relative to the station: bearing for the radar overlay and
 * visibility against the current range, threshold and proximity filters.
 */
export function viewHazard(
  hazard: HazardEvent,
  ownLat: number,
  ownLon: number,
  rangeM: number,
  thresholdM: number,
): HazardView {
  const distanceM = haversineM(ownLat, ownLon, hazard.lat, hazard.lon);
  const bearing = bearingDeg(ownLat, ownLon, hazard.lat, hazard.lon);
  return {
    ...hazard,
    distanceM,
    bearingDeg: bearing,
    isNear: distanceM <= thresholdM,
    isVisible: distanceM <= rangeM,
  };
}
