import { bearingDeg, haversineM, normalizeDeg } from "./geo";

export interface CourseSample {
  latitude: number;
  longitude: number;
  timestamp: number;
  headingDeg: number | null;
  speedMps: number | null;
  accuracyM: number | null;
}

const MIN_COURSE_SPEED_MPS = 0.8;
const MIN_DISPLACEMENT_M = 5;
export const COURSE_MAX_SAMPLE_GAP_MS = 20_000;
export const COURSE_STALE_AFTER_MS = 12_000;

/** Where a true bearing appears on a scope whose top points along course. */
export function toScreenBearing(trueBearing: number, courseHeading: number): number {
  return normalizeDeg(trueBearing - courseHeading);
}

/** Prefer the GPS course; fall back to the bearing between reliable fixes. */
export function estimateCourse(
  previous: CourseSample | null,
  current: CourseSample,
): number | null {
  const validAccuracy =
    current.accuracyM === null || current.accuracyM <= 35;
  if (
    current.headingDeg !== null &&
    Number.isFinite(current.headingDeg) &&
    current.headingDeg >= 0 &&
    current.headingDeg < 360 &&
    current.speedMps !== null &&
    current.speedMps >= MIN_COURSE_SPEED_MPS &&
    validAccuracy
  ) {
    return normalizeDeg(current.headingDeg);
  }

  if (!previous) return null;
  const elapsedMs = current.timestamp - previous.timestamp;
  if (elapsedMs < 1_000 || elapsedMs > COURSE_MAX_SAMPLE_GAP_MS) return null;
  if (
    (previous.accuracyM !== null && previous.accuracyM > 35) ||
    !validAccuracy
  ) {
    return null;
  }

  const displacement = haversineM(
    previous.latitude,
    previous.longitude,
    current.latitude,
    current.longitude,
  );
  const speed = displacement / (elapsedMs / 1000);
  if (displacement < MIN_DISPLACEMENT_M || speed < MIN_COURSE_SPEED_MPS) {
    return null;
  }

  return bearingDeg(
    previous.latitude,
    previous.longitude,
    current.latitude,
    current.longitude,
  );
}

/** Smooths across the 0°/360° boundary using the shortest angular arc. */
export function smoothCourse(
  previous: number,
  next: number,
  amount = 0.24,
): number {
  const delta = ((normalizeDeg(next) - normalizeDeg(previous) + 540) % 360) - 180;
  return normalizeDeg(previous + delta * amount);
}
