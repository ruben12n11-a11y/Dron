/** Natural hazard reported by the NASA EONET feed, placed near the station. */
export interface HazardEvent {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  categoryId: string;
  /** Human-readable Spanish category label. */
  categoryLabel: string;
  lat: number;
  lon: number;
  /** When the event geometry was observed, epoch milliseconds. */
  observedAt: number;
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
  /** Distance from the station in meters, filled by the client. */
  distanceM: number;
}

export interface HazardFetchResult {
  hazards: HazardEvent[];
  fetchedAt: number;
}

export interface SpaceWeatherSample {
  kpIndex: number;
  observedAt: number;
}

export interface SpaceWeather {
  maxKpIndex: number | null;
  observedAt: number | null;
  samples: SpaceWeatherSample[];
  /** True when recent geomagnetic activity can degrade GNSS accuracy. */
  gnssRisk: boolean;
}

export interface SpaceWeatherFetchResult {
  weather: SpaceWeather;
  fetchedAt: number;
}

export interface HazardDto {
  id: string;
  title: string;
  description: string | null;
  link: string | null;
  categoryId: string;
  categoryTitle: string;
  lat: number;
  lon: number;
  observedAt: number;
  magnitudeValue: number | null;
  magnitudeUnit: string | null;
  distanceKm?: number;
}
