import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import en from "@/lib/i18n/en";
import ko from "@/lib/i18n/ko";
import ru from "@/lib/i18n/ru";
import uz from "@/lib/i18n/uz";
import {
  I18nContext,
  isLocale,
  type Dictionary,
  type Locale,
} from "@/lib/i18n/index";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ko, ru, uz };
const STORAGE_KEY = "hrc.locale";

/**
 * Resolves and persists the interface language.
 *
 * The device language seeds the first launch; an explicit choice always wins
 * afterwards. A language is not a secret, so it lives in AsyncStorage —
 * SecureStore is reserved for credentials, and putting a preference in the
 * keychain would add an encrypted read to every cold start for nothing.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => deviceLocale());

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isLocale(stored)) setLocaleState(stored);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ locale, d: DICTIONARIES[locale], setLocale }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The device's language if we speak it, else English. */
function deviceLocale(): Locale {
  try {
    const tag = getLocales()[0]?.languageCode ?? "en";
    return isLocale(tag) ? tag : "en";
  } catch {
    return "en";
  }
}
