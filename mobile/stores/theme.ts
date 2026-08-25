import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";

/**
 * The colour scheme. Client UI state, and nothing else.
 *
 * ## Why this is allowed in Zustand
 *
 * Theme is a device display preference the server neither owns nor cares
 * about. It is exactly the shape of state Zustand is for. Plan, profile,
 * jobs and notifications all belong to the backend and live in TanStack
 * Query — none of them are mirrored here.
 *
 * ## Why AsyncStorage and not SecureStore
 *
 * A theme is not a secret. SecureStore is reserved for credentials; putting
 * a preference in the keychain would add a slow encrypted read to launch for
 * no benefit at all.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "hrc.theme";

interface ThemeState {
  choice: ThemeChoice;
  /** What is actually on screen, after resolving "system". */
  resolved: ResolvedTheme;
  hydrated: boolean;
  setChoice: (choice: ThemeChoice) => void;
  hydrate: () => Promise<void>;
}

function systemTheme(): ResolvedTheme {
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  return choice === "system" ? systemTheme() : choice;
}

export const useThemeStore = create<ThemeState>((set) => ({
  choice: "system",
  resolved: systemTheme(),
  hydrated: false,

  setChoice(choice) {
    set({ choice, resolved: resolve(choice) });
    // Fire-and-forget: a failed write costs the preference next launch, and
    // is never worth blocking a tap on.
    void AsyncStorage.setItem(STORAGE_KEY, choice).catch(() => undefined);
  },

  async hydrate() {
    try {
      const stored = (await AsyncStorage.getItem(STORAGE_KEY)) as ThemeChoice | null;
      const choice: ThemeChoice =
        stored === "light" || stored === "dark" || stored === "system"
          ? stored
          : "system";
      set({ choice, resolved: resolve(choice), hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
}));
