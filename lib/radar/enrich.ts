import { computeTurnDeg } from "./detection";
import { bearingDeg, haversineM } from "./geo";
import type {
  EnrichedContact,
  PositionSample,
  RadarContact,
  RadarSettings,
} from "./types";

export function enrichContact(
  contact: RadarContact,
  settings: RadarSettings,
  history: PositionSample[],
): EnrichedContact {
  const distanceM = haversineM(
    settings.ownLat,
    settings.ownLon,
    contact.lat,
    contact.lon,
  );
  const contactBearing = bearingDeg(
    settings.ownLat,
    settings.ownLon,
    contact.lat,
    contact.lon,
  );
  const isVisible =
    distanceM <= settings.rangeM &&
    contact.altFt >= settings.minAltFt &&
    contact.speedKt >= settings.minSpeedKt;

  return {
    ...contact,
    distanceM,
    bearingDeg: contactBearing,
    isNear: distanceM <= settings.thresholdM,
    isVisible,
    turnDeg: computeTurnDeg(history),
  };
}
