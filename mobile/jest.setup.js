/**
 * Test doubles for the native modules these units touch.
 *
 * SecureStore is mocked with an in-memory map so the storage tests can assert
 * WHICH store was used without a keychain — the point of those tests is that
 * tokens never reach AsyncStorage, which a real device would not reveal.
 */
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key) => void store.delete(key)),
  };
});

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => void store.set(key, value)),
    removeItem: jest.fn(async (key) => void store.delete(key)),
  };
});

/*
 * Metro defines `__DEV__` for every bundle; jest does not. Modules that
 * branch on it are ordinary application code, so the flag is declared here
 * rather than each of them guarding for a global that always exists on a
 * device.
 */
global.__DEV__ = false;

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: "127.0.0.1:8081" } },
}));

/*
 * Native modules these units import but never call.
 *
 * `expo-web-browser` and friends ship untranspiled ESM, which this node
 * environment cannot parse. The tests here assert what the code DOES with
 * them — that a checkout opens a hosted URL, that a picker is never reachable
 * from a recruiter screen — so a stub is enough, and transpiling the whole
 * of node_modules to reach the same assertions is not worth the runtime.
 */
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: "dismiss" })),
  openBrowserAsync: jest.fn(async () => ({ type: "opened" })),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: "s", Warning: "w", Error: "e" },
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock("socket.io-client", () => ({ io: jest.fn(() => ({ on: jest.fn(), emit: jest.fn() })) }));

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => () => undefined) },
}));
