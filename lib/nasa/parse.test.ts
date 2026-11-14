import { describe, expect, it } from "vitest";

import {
  formatKp,
  hazardCategoryLabel,
  kpSeverity,
  kpSeverityLabel,
  pickMaxKp,
  sanitizeSpaceWeather,
  toHazard,
} from "./parse";
import type { HazardDto } from "./types";

const STATION = { lat: 37.7749, lon: -122.4194 };

function hazard(overrides: Partial<HazardDto> = {}): HazardDto {
  return {
    id: "EONET_1",
    title: "Wildfire TEST, California",
    description: "12 Miles N from Somewhere",
    link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1",
    categoryId: "wildfires",
    categoryTitle: "Wildfires",
    lat: 37.8,
    lon: -122.4,
    observedAt: 1_700_000_000_000,
    magnitudeValue: 100,
    magnitudeUnit: "acres",
    ...overrides,
  };
}

describe("toHazard", () => {
  it("accepts a valid event and computes distance from the station", () => {
    const result = toHazard(hazard(), STATION.lat, STATION.lon);
    expect(result).not.toBeNull();
    expect(result?.categoryLabel).toBe("Incendio forestal");
    expect(result?.distanceM).toBeGreaterThan(0);
    expect(result?.distanceM).toBeLessThan(20_000);
  });

  it("rejects out-of-range or malformed coordinates", () => {
    expect(toHazard(hazard({ lat: 120 }), STATION.lat, STATION.lon)).toBeNull();
    expect(toHazard(hazard({ lon: -400 }), STATION.lat, STATION.lon)).toBeNull();
    expect(
      toHazard(hazard({ lat: Number.NaN }), STATION.lat, STATION.lon),
    ).toBeNull();
  });

  it("rejects events without a usable id or title", () => {
    expect(toHazard(hazard({ id: "" }), STATION.lat, STATION.lon)).toBeNull();
    const noTitle = { ...hazard(), title: null } as unknown as HazardDto;
    expect(toHazard(noTitle, STATION.lat, STATION.lon)).toBeNull();
  });

  it("falls back to a generic label for unknown categories", () => {
    const result = toHazard(
      hazard({ categoryId: "unknown-x", categoryTitle: "" }),
      STATION.lat,
      STATION.lon,
    );
    expect(result?.categoryLabel).toBe("Evento natural");
  });
});

describe("hazardCategoryLabel", () => {
  it("maps known EONET categories to Spanish", () => {
    expect(hazardCategoryLabel("volcanoes")).toBe("Actividad volcánica");
    expect(hazardCategoryLabel("severeStorms")).toBe("Tormenta severa");
  });
});

describe("sanitizeSpaceWeather", () => {
  it("keeps valid samples and derives the max Kp", () => {
    const weather = sanitizeSpaceWeather({
      samples: [
        { kpIndex: 4.3, observedAt: 1_000 },
        { kpIndex: 6, observedAt: 2_000 },
        { kpIndex: 5.1, observedAt: 1_500 },
      ],
      gnssRisk: true,
    });
    expect(weather.samples).toHaveLength(3);
    expect(weather.maxKpIndex).toBe(6);
    expect(weather.observedAt).toBe(2_000);
    expect(weather.gnssRisk).toBe(true);
  });

  it("drops malformed samples and returns an empty shape for garbage", () => {
    const weather = sanitizeSpaceWeather({
      samples: [{ kpIndex: "x", observedAt: 1 }, { kpIndex: 3, observedAt: null }],
      gnssRisk: false,
    });
    expect(weather.samples).toHaveLength(0);
    expect(weather.maxKpIndex).toBeNull();
    expect(sanitizeSpaceWeather(null)).toEqual({
      maxKpIndex: null,
      observedAt: null,
      samples: [],
      gnssRisk: false,
    });
  });
});

describe("pickMaxKp / severity / formatting", () => {
  it("returns null for an empty window", () => {
    expect(pickMaxKp([])).toBeNull();
  });

  it("classifies Kp into severity bands", () => {
    expect(kpSeverity(3)).toBe("info");
    expect(kpSeverity(5)).toBe("warning");
    expect(kpSeverity(8)).toBe("critical");
  });

  it("labels each severity band in Spanish", () => {
    expect(kpSeverityLabel("info")).toBe("baja");
    expect(kpSeverityLabel("warning")).toBe("moderada");
    expect(kpSeverityLabel("critical")).toBe("severa");
  });

  it("formats Kp with one decimal", () => {
    expect(formatKp(6)).toBe("Kp 6.0");
    expect(formatKp(5.33)).toBe("Kp 5.3");
  });
});
