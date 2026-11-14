import { RADAR } from "@/constants/radar-theme";

import type { AlertKind, AlertSeverity } from "./types";

export function alertColor(severity: AlertSeverity): string {
  if (severity === "critical") return RADAR.colors.red;
  if (severity === "warning") return RADAR.colors.amber;
  return RADAR.colors.cyan;
}

export function alertKindLabel(kind: AlertKind): string {
  switch (kind) {
    case "proximity":
      return "PROXIMIDAD";
    case "turn":
      return "TRAYECTORIA";
    case "uas":
      return "POSIBLE UAS";
    case "hazard":
      return "EVENTO NATURAL";
    default:
      return "SISTEMA";
  }
}

export function severityLabel(severity: AlertSeverity): string {
  if (severity === "critical") return "CRÍTICA";
  if (severity === "warning") return "ADVERTENCIA";
  return "INFO";
}
