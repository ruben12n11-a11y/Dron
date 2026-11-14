export interface ForegroundLocationPermission {
  granted: boolean;
  canAskAgain: boolean;
}

export interface ForegroundLocationFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface ForegroundLocationClient {
  getPermission(): Promise<ForegroundLocationPermission>;
  requestPermission(): Promise<ForegroundLocationPermission>;
  getPosition(): Promise<ForegroundLocationFix>;
}

export type ForegroundLocationResult =
  | { status: "denied"; canAskAgain: boolean }
  | { status: "invalid" }
  | ({ status: "located" } & ForegroundLocationFix);

/** Called only from an explicit user action; it never starts background tracking. */
export async function readForegroundLocation(
  client: ForegroundLocationClient,
): Promise<ForegroundLocationResult> {
  let permission = await client.getPermission();
  if (!permission.granted) {
    permission = await client.requestPermission();
  }

  if (!permission.granted) {
    return { status: "denied", canAskAgain: permission.canAskAgain };
  }

  const position = await client.getPosition();
  if (
    !Number.isFinite(position.latitude) ||
    position.latitude < -90 ||
    position.latitude > 90 ||
    !Number.isFinite(position.longitude) ||
    position.longitude < -180 ||
    position.longitude > 180
  ) {
    return { status: "invalid" };
  }

  return { status: "located", ...position };
}
