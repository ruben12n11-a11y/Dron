import { describe, expect, it } from "vitest";

import { destinationPoint } from "./geo";
import {
  estimateCourse,
  smoothCourse,
  toScreenBearing,
  type CourseSample,
} from "./course";

function sample(
  latitude: number,
  longitude: number,
  timestamp: number,
  overrides: Partial<CourseSample> = {},
): CourseSample {
  return {
    latitude,
    longitude,
    timestamp,
    headingDeg: null,
    speedMps: null,
    accuracyM: 5,
    ...overrides,
  };
}

describe("estimación del rumbo de marcha", () => {
  it("prefiere el rumbo GPS cuando el dispositivo se desplaza", () => {
    expect(
      estimateCourse(
        null,
        sample(37.77, -122.42, 1000, { headingDeg: 181, speedMps: 1.2 }),
      ),
    ).toBe(181);
  });

  it("al avanzar al sur pone S arriba y N abajo en modo rumbo-arriba", () => {
    expect(toScreenBearing(180, 180)).toBe(0);
    expect(toScreenBearing(0, 180)).toBe(180);
  });

  it("deduce rumbo sur de dos posiciones separadas", () => {
    const start = { latitude: 37.77, longitude: -122.42 };
    const end = destinationPoint(start.latitude, start.longitude, 10, 180);
    const result = estimateCourse(
      sample(start.latitude, start.longitude, 1000),
      sample(end.lat, end.lon, 9000),
    );

    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(180, 0);
  });

  it("acumula pasos GPS cortos antes de deducir el curso", () => {
    const start = { latitude: 37.77, longitude: -122.42 };
    const threeMeters = destinationPoint(start.latitude, start.longitude, 3, 180);
    const sixMeters = destinationPoint(start.latitude, start.longitude, 6, 180);
    const baseline = sample(start.latitude, start.longitude, 1000);

    expect(
      estimateCourse(baseline, sample(threeMeters.lat, threeMeters.lon, 4000)),
    ).toBeNull();
    expect(
      estimateCourse(baseline, sample(sixMeters.lat, sixMeters.lon, 7000)),
    ).toBeCloseTo(180, 0);
  });

  it("ignora posiciones inmóviles o demasiado ruidosas", () => {
    const start = sample(37.77, -122.42, 1000);
    expect(estimateCourse(start, sample(37.770001, -122.42, 5000))).toBeNull();
    expect(
      estimateCourse(
        null,
        sample(37.77, -122.42, 1000, {
          headingDeg: 180,
          speedMps: 1.2,
          accuracyM: 80,
        }),
      ),
    ).toBeNull();
  });

  it("suaviza el salto entre 359° y 0° por el arco menor", () => {
    expect(smoothCourse(350, 10, 0.5)).toBeCloseTo(0);
  });
});
