export type RuntimeMode = "connecting" | "live";

export type FeedStatus = "connecting" | "live" | "error";

export type ContactKind = "drone" | "aircraft";

export type ContactSource = "opensky";

export type OrientationMode = "north" | "course";
export type CourseTrackingStatus = "off" | "waiting" | "active" | "paused" | "error";

export interface RadarSettings {
  /** Station latitude in decimal degrees. */
  ownLat: number;
  /** Station longitude in decimal degrees. */
  ownLon: number;
  /** Distance at which a contact is considered close, in meters. */
  thresholdM: number;
  /** Outer radar range, in meters. */
  rangeM: number;
  /** Minimum altitude for a contact to be displayed and analyzed, in feet. */
  minAltFt: number;
  /** Minimum ground speed for a contact to be displayed and analyzed, in knots. */
  minSpeedKt: number;
  /** Keep north at the top, or rotate the scope to align with GPS travel course. */
  orientationMode: OrientationMode;
  haptics: boolean;
  proximityAlerts: boolean;
  turnAlerts: boolean;
  uasAlerts: boolean;
  /** Show NASA EONET natural hazards as an overlay on the radar. */
  showHazards: boolean;
  /** Raise an alert when a natural hazard falls inside the proximity threshold. */
  hazardAlerts: boolean;
}

export interface RadarContact {
  id: string;
  callsign: string;
  icao: string;
  lat: number;
  lon: number;
  altFt: number;
  speedKt: number;
  headingDeg: number;
  verticalRateFpm: number;
  category: string | null;
  kind: ContactKind;
  /** ADS-B hints indicating a possible UAS/drone. */
  uas: boolean;
  source: ContactSource;
  lastSeen: number;
}

export interface EnrichedContact extends RadarContact {
  distanceM: number;
  bearingDeg: number;
  isNear: boolean;
  isVisible: boolean;
  /** Trajectory reversal computed from the last three position samples. */
  turnDeg: number;
}

export type AlertKind = "proximity" | "turn" | "uas" | "hazard" | "system";

export type AlertSeverity = "critical" | "warning" | "info";

export interface RadarAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  contactId?: string;
  callsign?: string;
  timestamp: number;
  distanceM?: number;
  altFt?: number;
  speedKt?: number;
}

export interface FeedState {
  mode: RuntimeMode;
  status: FeedStatus;
  /** Timestamp of the last validated OpenSky snapshot. */
  lastUpdate: number | null;
  message: string;
}

export interface PositionSample {
  t: number;
  lat: number;
  lon: number;
}

export interface RadarMetrics {
  /** Contacts currently visible inside the range and filters. */
  total: number;
  /** Visible contacts inside the proximity threshold. */
  near: number;
  /** Visible contacts flagged as possible UAS. */
  uas: number;
  /** Tracked contacts hidden by range or filters. */
  hidden: number;
}
