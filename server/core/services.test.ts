import { describe, expect, it } from "vitest";

import { MemoryCacheStore } from "./cache";
import { buildBoundingBox, haversineKm } from "./geo";
import { RadarService } from "./radar-service";
import { NasaService, mapHazard, mapSpaceWeather } from "./nasa-service";

/** Stub for the external HTTP boundary; the service logic under test is real. */
function stubFetch(handler: (url: URL) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = handler(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const MADRID = { lat: 40.4, lon: -3.7 };

/** Builds an OpenSky state vector with sane defaults. */
function state(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const base: unknown[] = [
    "abc123",
    "IBE1234 ",
    "Spain",
    1_700_000_000,
    1_700_000_001,
    -3.7,
    40.4,
    10_000,
    false,
    250,
    90,
    0,
    null,
    10_000,
    "1234",
    false,
    0,
    2,
  ];
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value;
  }
  return base;
}

describe("RadarService", () => {
  it("maps a valid state vector and converts units", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        states: [state()],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 100);
    expect(result.states).toHaveLength(1);
    const aircraft = result.states[0];
    expect(aircraft.icao).toBe("abc123");
    expect(aircraft.callsign).toBe("IBE1234");
    expect(aircraft.altFt).toBeCloseTo(32_808, 0);
    expect(aircraft.speedKt).toBeCloseTo(486, 0);
    expect(aircraft.category).toBe(2);
  });

  it("rejects on-ground, invalid-icao and out-of-range records", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        states: [
          state({ 8: true }), // on ground
          state({ 0: "NOTHEX" }), // bad icao
          state({ 6: 200 }), // latitude out of range
          state(),
        ],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 100);
    expect(result.states).toHaveLength(1);
  });

  it("drops aircraft outside the requested radius", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor(Date.now() / 1000),
        // ~1 degree north is roughly 111 km away from Madrid.
        states: [state(), state({ 6: 41.4 })],
      })),
    });

    const result = await service.states(MADRID.lat, MADRID.lon, 50);
    expect(result.states).toHaveLength(1);
  });

  it("rejects a stale upstream sample as not live", async () => {
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({
        time: Math.floor((Date.now() - 60 * 60_000) / 1000),
        states: [state()],
      })),
    });

    await expect(service.states(MADRID.lat, MADRID.lon, 100)).rejects.toThrow(
      /vencida/,
    );
  });

  it("serves a second identical call from cache without refetching", async () => {
    let calls = 0;
    const service = new RadarService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => {
        calls += 1;
        return { time: Math.floor(Date.now() / 1000), states: [state()] };
      }),
    });

    await service.states(MADRID.lat, MADRID.lon, 100);
    await service.states(MADRID.lat, MADRID.lon, 100);
    expect(calls).toBe(1);
  });
});

describe("NasaService", () => {
  const event = {
    id: "EONET_1",
    title: "Wildfire in Portugal",
    description: "desc",
    link: "https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1",
    categories: [{ id: "wildfires", title: "Wildfires" }],
    geometry: [
      {
        date: "2026-11-10T00:00:00Z",
        type: "Point",
        coordinates: [-8.0, 39.5],
        magnitudeValue: 100,
        magnitudeUnit: "acres",
      },
    ],
  };

  it("maps a hazard inside the circle and computes its distance", async () => {
    const service = new NasaService({
      cache: new MemoryCacheStore(),
      fetchImpl: stubFetch(() => ({ events: [event] })),
    });

    const result = await service.hazards(39.5, -8.0, 200);
    expect(result.hazards).toHaveLength(1);
    expect(result.hazards[0].categoryTitle).toBe("Wildfires");
    expect(result.hazards[0].distanceKm).toBeCloseTo(0, 3);
  });

  it("reports the highest Kp and flags GNSS risk at the threshold", () => {
    const now = Date.parse("2026-11-14T00:00:00Z");
    const value = mapSpaceWeather(
      [
        {
          allKpIndex: [
            { kpIndex: 3, observedTime: "2026-11-12T00:00:00Z" },
            { kpIndex: 6, observedTime: "2026-11-13T00:00:00Z" },
          ],
        },
      ],
      now,
    );

    expect(value.maxKpIndex).toBe(6);
    expect(value.gnssRisk).toBe(true);
    expect(value.samples).toHaveLength(2);
  });

  it("returns an empty space weather window instead of inventing values", () => {
    const value = mapSpaceWeather([], Date.now());
    expect(value.maxKpIndex).toBeNull();
    expect(value.observedAt).toBeNull();
    expect(value.gnssRisk).toBe(false);
  });

  it("fails the hazards request when EONET is unreachable", async () => {
    const service = new NasaService({
      cache: new MemoryCacheStore(),
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as typeof fetch,
    });

    await expect(service.hazards(39.5, -8.0, 200)).rejects.toThrow(
      /EONET/,
    );
  });
});

describe("mapHazard", () => {
  it("ignores geometry outside the radius and keeps the most recent inside", () => {
    const mapped = mapHazard(
      {
        id: "EONET_2",
        title: "Storm",
        categories: [{ id: "severeStorms", title: "Severe Storms" }],
        geometry: [
          { date: "2026-01-01T00:00:00Z", coordinates: [0, 0] },
          { date: "2026-02-01T00:00:00Z", coordinates: [-8.0, 39.5] },
          { date: "2026-03-01T00:00:00Z", coordinates: [10, 50] },
        ],
      },
      39.5,
      -8.0,
      200,
    );

    expect(mapped).not.toBeNull();
    expect(mapped?.lat).toBe(39.5);
    expect(mapped?.categoryId).toBe("severeStorms");
  });

  it("returns null for malformed events", () => {
    expect(mapHazard(null, 0, 0, 100)).toBeNull();
    expect(mapHazard({ id: "x" }, 0, 0, 100)).toBeNull();
  });
});

describe("geo helpers", () => {
  it("builds a bbox that contains the centre", () => {
    const box = buildBoundingBox(MADRID.lat, MADRID.lon, 100);
    expect(box.lamin).toBeLessThanOrEqual(MADRID.lat);
    expect(box.lamax).toBeGreaterThanOrEqual(MADRID.lat);
    expect(box.global).toBe(false);
  });

  it("falls back to a global band across the antimeridian", () => {
    const box = buildBoundingBox(0, 179.9, 100);
    expect(box.global).toBe(true);
    expect(box.lomin).toBe(-180);
    expect(box.lomax).toBe(180);
  });

  it("measures a known distance", () => {
    // Madrid to Lisbon is roughly 502 km.
    const distance = haversineKm(40.4168, -3.7038, 38.7223, -9.1393);
    expect(distance).toBeGreaterThan(490);
    expect(distance).toBeLessThan(515);
  });
});
