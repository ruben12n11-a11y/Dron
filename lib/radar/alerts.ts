import {
  formatAltitude,
  formatBearing,
  formatDistance,
  formatSpeed,
} from "./geo";
import type { AlertSeverity, EnrichedContact, RadarAlert } from "./types";

let alertSequence = 0;

function nextId(kind: string, contactId?: string): string {
  alertSequence += 1;
  return `${kind}-${contactId ?? "system"}-${Date.now()}-${alertSequence}`;
}

export function createProximityAlert(
  contact: EnrichedContact,
  thresholdM: number,
  now: number,
): RadarAlert {
  return {
    id: nextId("proximity", contact.id),
    kind: "proximity",
    severity: "critical",
    title: "Contacto dentro del umbral",
    message: `${contact.callsign} a ${formatDistance(contact.distanceM)} · rumbo ${formatBearing(
      contact.bearingDeg,
    )} · ${formatAltitude(contact.altFt)}. Umbral configurado: ${formatDistance(thresholdM)}.`,
    contactId: contact.id,
    callsign: contact.callsign,
    timestamp: now,
    distanceM: contact.distanceM,
    altFt: contact.altFt,
    speedKt: contact.speedKt,
  };
}

export function createTurnAlert(contact: EnrichedContact, now: number): RadarAlert {
  return {
    id: nextId("turn", contact.id),
    kind: "turn",
    severity: "warning",
    title: "Reversión de trayectoria",
    message: `${contact.callsign} giró ${Math.round(
      contact.turnDeg,
    )}° · ${formatDistance(contact.distanceM)} · ${formatSpeed(
      contact.speedKt,
    )} · ${formatAltitude(contact.altFt)}.`,
    contactId: contact.id,
    callsign: contact.callsign,
    timestamp: now,
    distanceM: contact.distanceM,
    altFt: contact.altFt,
    speedKt: contact.speedKt,
  };
}

export function createUasAlert(contact: EnrichedContact, now: number): RadarAlert {
  return {
    id: nextId("uas", contact.id),
    kind: "uas",
    severity: "critical",
    title: "Posible UAS detectado",
    message: `Indicios ADS-B en ${contact.callsign} (${contact.icao}) · ${formatDistance(
      contact.distanceM,
    )} · ${formatAltitude(contact.altFt)} · ${formatSpeed(
      contact.speedKt,
    )}. Categoría: ${contact.category ?? "no reportada"}.`,
    contactId: contact.id,
    callsign: contact.callsign,
    timestamp: now,
    distanceM: contact.distanceM,
    altFt: contact.altFt,
    speedKt: contact.speedKt,
  };
}

export function createSystemAlert(
  title: string,
  message: string,
  severity: AlertSeverity = "info",
): RadarAlert {
  return {
    id: nextId("system"),
    kind: "system",
    severity,
    title,
    message,
    timestamp: Date.now(),
  };
}

/** Proximity alert for a NASA EONET natural hazard near the station. */
export function createHazardAlert(
  hazard: {
    id: string;
    title: string;
    categoryLabel: string;
    distanceM: number;
    bearingDeg: number;
    magnitudeValue: number | null;
    magnitudeUnit: string | null;
  },
  thresholdM: number,
  now: number,
): RadarAlert {
  const magnitude =
    hazard.magnitudeValue !== null
      ? ` · ${hazard.magnitudeValue.toLocaleString("es-ES")} ${
          hazard.magnitudeUnit ?? ""
        }`.trimEnd()
      : "";
  return {
    id: nextId("hazard", hazard.id),
    kind: "hazard",
    severity: "warning",
    title: "Evento natural cercano",
    message: `${hazard.title} · ${hazard.categoryLabel} a ${formatDistance(
      hazard.distanceM,
    )} · rumbo ${formatBearing(hazard.bearingDeg)}${magnitude}. Umbral: ${formatDistance(
      thresholdM,
    )}.`,
    contactId: `hazard:${hazard.id}`,
    callsign: hazard.title,
    timestamp: now,
    distanceM: hazard.distanceM,
  };
}

/** GNSS integrity advisory driven by the DONKI geomagnetic Kp index. */
export function createGnssAlert(
  kpIndex: number,
  observedAt: number,
  severity: AlertSeverity,
  now: number,
): RadarAlert {
  return {
    id: nextId("system"),
    kind: "system",
    severity,
    title: "Clima espacial: GNSS degradado",
    message: `NASA DONKI reporta Kp ${kpIndex.toFixed(
      1,
    )} (${new Date(observedAt).toISOString()}). La actividad geomagnética puede degradar la precisión GPS del radar; verifica la posición de la estación.`,
    timestamp: now,
  };
}
