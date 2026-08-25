import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearTokens, readTokens, writeTokens } from "@/lib/storage/secure";

/**
 * The security property this whole module exists for: session secrets go to
 * the OS keychain, and never to AsyncStorage, which is unencrypted plain
 * text on disk and survives in device backups.
 */
describe("token storage", () => {
  beforeEach(async () => {
    await clearTokens();
    jest.clearAllMocks();
  });

  it("round-trips a token pair through SecureStore", async () => {
    await writeTokens({ accessToken: "a", refreshToken: "r" });
    await expect(readTokens()).resolves.toEqual({
      accessToken: "a",
      refreshToken: "r",
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalled();
  });

  it("never writes a token to AsyncStorage", async () => {
    await writeTokens({ accessToken: "secret-access", refreshToken: "secret-refresh" });

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    const plain = JSON.stringify([
      ...((AsyncStorage as unknown as { __store: Map<string, string> }).__store ?? []),
    ]);
    expect(plain).not.toContain("secret-access");
    expect(plain).not.toContain("secret-refresh");
  });

  it("reports signed-out rather than throwing when the store fails", async () => {
    jest
      .mocked(SecureStore.getItemAsync)
      .mockRejectedValueOnce(new Error("keychain unavailable"));
    await expect(readTokens()).resolves.toBeNull();
  });

  it("treats a half-written pair as no session", async () => {
    await SecureStore.setItemAsync("hrc.accessToken", "only-access");
    await expect(readTokens()).resolves.toBeNull();
  });

  it("clears both tokens", async () => {
    await writeTokens({ accessToken: "a", refreshToken: "r" });
    await clearTokens();
    await expect(readTokens()).resolves.toBeNull();
  });
});
