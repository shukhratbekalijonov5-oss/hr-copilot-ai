"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  applyTheme,
  currentTheme,
  serverThemeSnapshot,
  subscribeToTheme,
  type Theme,
} from "@/lib/theme/theme";

/**
 * Sun/moon, in the header.
 *
 * ## The document is the source of truth
 *
 * The theme lives as a class on `<html>`, written before paint by the boot
 * script, so this reads it through `useSyncExternalStore` rather than keeping
 * a copy in React state. A copy could disagree with the screen — most visibly
 * when another tab switches the theme, which arrives here as a `storage`
 * event and re-renders the icon.
 *
 * The server has no document, so its snapshot is `null` and a fixed-size
 * placeholder holds the space. Rendering a guess is exactly what makes the
 * wrong icon flash on load, and it would trip hydration on every page.
 *
 * ## The icon shows what you will GET, not what you have
 *
 * A moon means "switch to dark". That is what readers expect from a single
 * toggle, and the `aria-label` says it in words so nobody has to infer the
 * direction from a pictogram.
 */
export function ThemeToggle() {
  const { d } = useI18n();
  const theme = useSyncExternalStore(
    subscribeToTheme,
    currentTheme,
    serverThemeSnapshot,
  );

  if (theme === null) {
    return <span className="size-9 shrink-0" aria-hidden="true" />;
  }

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={next === "dark" ? d.theme.switchToDark : d.theme.switchToLight}
      title={next === "dark" ? d.theme.switchToDark : d.theme.switchToLight}
      className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink"
    >
      {theme === "dark" ? (
        <SunIcon className="size-4.5" />
      ) : (
        <MoonIcon className="size-4.5" />
      )}
    </button>
  );
}
