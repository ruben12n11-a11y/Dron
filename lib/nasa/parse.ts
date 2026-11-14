import { haversineM } from "../radar/geo";

import type {
  HazardDto,
  HazardEvent,
  SpaceWeather,
  SpaceWeatherSample,
} from "./types";

/** Spanish labels for the EONET categories the feed actually returns. */
const CATEGORY_LABELS: Record<string, string> = {
  wildfires: "Incendio forestal",
  severeStorms: "Tormenta severa",
  volcanoes: "Actividad volcánica",
  seaLakeIce: "Hielo marino/lacustre",
  earthquakes: "Sismo",
  floods: "Inundación",
  landslides: "Deslizamiento",
  drought: "Sequía",
  dustHaze: "Polvo o calima",
  manmade: "Evento antrópico",
  snow: "Nieve",
  tempExtremes: "Temperatura extrema",
  waterColor: "Color del agua",
};

export function hazardCategoryLabel(categoryId: string, fallback?: string): string {
  const mapped = CATEGORY_LABELS[categoryId];
  if (mapped) return mapped;
  const trimmed = fallback?.trim();
  return trimmed ? trimmed : "Evento natural";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Validates and converts a server hazard into a client hazard, recomputing the
 * distance locally so the radar can plot it against the current station.
 */
export function toHazard(dto: HazardDto, ownLat: number, ownLon: number): HazardEvent | null {
  const lat = finiteNumber(dto.lat);
  const lon = finiteNumber(dto.lon);
  if (
    typeof dto.id !== "string" ||
    dto.id.trim() === "" ||
    typeof dto.title !== "string" ||
    dto.title.trim() === "" ||
    lat === null ||
    lat < -90 ||
    lat > 90 ||
    lon === null ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  return {
    id: dto.id,
    title: dto.title,
    description: typeof dto.description === "string" ? dto.description : null,
    link: typeof dto.link === "string" ? dto.link : null,
    categoryId: typeof dto.categoryId === "string" ? dto.categoryId : "unknown",
    categoryLabel: hazardCategoryLabel(dto.categoryId, dto.categoryTitle),
    lat,
    lon,
    observedAt: finiteNumber(dto.observedAt) ?? 0,
    magnitudeValue: finiteNumber(dto.magnitudeValue),
    magnitudeUnit:
      typeof dto.magnitudeUnit === "string" ? dto.magnitudeUnit : null,
    distanceM: haversineM(ownLat, ownLon, lat, lon),
  };
}

/** Highest Kp index in the window; ties resolve to the most recent sample. */
export function pickMaxKp(samples: SpaceWeatherSample[]): SpaceWeatherSample | null {
  let best: SpaceWeatherSample | null = null;
  for (const sample of samples) {
    if (!Number.isFinite(sample.kpIndex) || !Number.isFinite(sample.observedAt)) {
      continue;
    }
    if (!best || sample.kpIndex > best.kpIndex) best = sample;
  }
  return best;
}

export function sanitizeSpaceWeather(value: unknown): SpaceWeather {
  const empty: SpaceWeather = {
    maxKpIndex: null,
    observedAt: null,
    samples: [],
    gnssRisk: false,
  };
  if (!value || typeof value !== "object") return empty;
  const record = value as Record<string, unknown>;
  const rawSamples = Array.isArray(record.samples) ? record.samples : [];
  const samples: SpaceWeatherSample[] = rawSamples
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      const kpIndex = finiteNumber(entry.kpIndex);
      const observedAt = finiteNumber(entry.observedAt);
      if (kpIndex === null || observedAt === null) return null;
      return { kpIndex, observedAt };
    })
    .filter((sample): sample is SpaceWeatherSample => sample !== null)
    .sort((a, b) => a.observedAt - b.observedAt);

  const best = pickMaxKp(samples);
  return {
    maxKpIndex: best?.kpIndex ?? null,
    observedAt: best?.observedAt ?? null,
    samples,
    gnssRisk: record.gnssRisk === true,
  };
}

/** Formats the Kp index on the standard 0–9 scale with one decimal. */
export function formatKp(kpIndex: number): string {
  return `Kp ${kpIndex.toFixed(1)}`;
}

export function kpSeverity(kpIndex: number): "info" | "warning" | "critical" {
  if (kpIndex >= 7) return "critical";
  if (kpIndex >= 5) return "warning";
  return "info";
}

export function kpSeverityLabel(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") return "severa";
  if (severity === "warning") return "moderada";
  return "baja";
}
