import Constants from "expo-constants";

/**
 * Mobile-safe configuration only.
 *
 * `EXPO_PUBLIC_*` values are compiled into the shipped bundle and can be read
 * by anyone with the app, so this file may hold a base URL and nothing else.
 * No Toss key, no service token, no model key, no database credential ever
 * belongs here — those live server-side and reach the device only as the
 * result of an authorized API call.
 */
const FALLBACK_API = "http://localhost:3001/api";

/**
 * Resolves the API base for the current runtime.
 *
 * A device — physical or emulated — cannot reach the host's `localhost`, so
 * in development we fall back to the LAN address Expo already knows it is
 * serving from. That keeps `npm start` working on a real phone without every
 * developer hand-editing an env file, while production still requires an
 * explicit `EXPO_PUBLIC_API_BASE_URL`.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older/managed shapes keep it here; both are development-only.
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  if (__DEV__ && hostUri) {
    const host = hostUri.split(":")[0];
    if (host) return `http://${host}:3001/api`;
  }

  return FALLBACK_API;
}

export const API_BASE_URL = resolveApiBaseUrl();

/** One place to change the network patience for the whole app. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The socket.io namespace the chat gateway exposes.
 *
 * Derived from the API base rather than configured separately: two settings
 * for one server is how a staging build ends up talking to two different
 * backends. The `/api` suffix is stripped because the gateway is mounted on
 * the origin, not under the REST prefix.
 */
export const CHAT_SOCKET_URL = `${API_BASE_URL.replace(/\/api\/?$/, "")}/chat`;
