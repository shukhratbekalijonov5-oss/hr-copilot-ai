import * as SecureStore from "expo-secure-store";

/**
 * The only place session secrets are read or written.
 *
 * Tokens go to the OS keychain (iOS) / keystore-backed store (Android) via
 * SecureStore, never AsyncStorage — AsyncStorage is unencrypted plain text on
 * disk and is readable on a rooted or jailbroken device, and on a backup.
 * That distinction is the whole reason this module exists rather than callers
 * picking a store each time.
 *
 * Every operation is best-effort: a keychain read can fail (device locked,
 * store corrupted, permissions changed) and a failure to READ a token must
 * degrade to "signed out", never crash the app on launch.
 */
const ACCESS_TOKEN_KEY = "hrc.accessToken";
const REFRESH_TOKEN_KEY = "hrc.refreshToken";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function readTokens(): Promise<TokenPair | null> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    ]);
    if (!accessToken || !refreshToken) return null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

export async function writeTokens(pair: TokenPair): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, pair.accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, pair.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  } catch {
    // Already gone, or the store is unavailable. Either way the caller's
    // intent — "this device is signed out" — is satisfied by the in-memory
    // clear that accompanies every call to this function.
  }
}
