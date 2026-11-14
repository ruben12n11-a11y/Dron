const EARTH_RADIUS_M = 6_371_000;

const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
const toDeg = (radians: number): number => (radians * 180) / Math.PI;

/** Great-circle distance between two coordinates, in meters. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))));
}

/** Initial bearing from point 1 to point 2, normalized to [0, 360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Destination coordinate after travelling a distance along a bearing. */
export function destinationPoint(
  lat: number,
  lon: number,
  distanceM: number,
  bearing: number,
): { lat: number; lon: number } {
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearing);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(angularDistance) +
    Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(theta);
  const phi2 = Math.asin(clamp(sinPhi2, -1, 1));

  const y = Math.sin(theta) * Math.sin(angularDistance) * Math.cos(phi1);
  const x = Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    lat: toDeg(phi2),
    lon: ((toDeg(lambda2) + 540) % 360) - 180,
  };
}

/** Smallest absolute difference between two bearings, in degrees. */
export function angleDiffDeg(a: number, b: number): number {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function normalizeDeg(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";
  if (meters < 1000) {
    const rounded = Math.round(meters / 10) * 10;
    return `${Math.max(0, rounded)} m`;
  }
  if (meters < 10_000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

export function formatAltitude(feet: number): string {
  if (!Number.isFinite(feet)) return "—";
  return `${formatInt(feet)} ft`;
}

export function formatSpeed(knots: number): string {
  if (!Number.isFinite(knots)) return "—";
  return `${formatInt(knots)} kt`;
}

export function formatBearing(degrees: number): string {
  if (!Number.isFinite(degrees)) return "—";
  return `${String(Math.round(normalizeDeg(degrees))).padStart(3, "0")}°`;
}

export function formatInt(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "O";
  return `${Math.abs(lat).toFixed(4)}° ${ns} · ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** UTC time for source timestamps received from OpenSky. */
export function formatClockUtc(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "--:--:--";
  return new Date(timestamp).toISOString().slice(11, 19);
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "ahora";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(timestamp).toLocaleDateString("es-ES");
}

const COMPASS_POINTS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSO",
  "SO",
  "OSO",
  "O",
  "ONO",
  "NO",
  "NNO",
] as const;

export function bearingToCompass(degrees: number): string {
  const index = Math.round(normalizeDeg(degrees) / 22.5) % 16;
  return COMPASS_POINTS[index];
}

/** Converts a distance in meters to the nearest of a set of display ranges. */
export function formatRange(meters: number): string {
  return formatDistance(meters);
}
