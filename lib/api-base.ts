import Constants from "expo-constants";

import { getApiBaseUrl } from "@/constants/oauth";

/**
 * Resolves the API host for the app.
 *
 * On native Expo Go the platform does not inject EXPO_PUBLIC_API_BASE_URL, so
 * the API host is derived from the Metro host. Metro runs on 8081 and the API
 * server on 3000.
 */
export function resolveApiBase(): string {
  const configured = getApiBaseUrl();
  if (configured) return configured;

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host) return `http://${host}:3000`;
  }
  return "";
}
