/**
 * The smallest theme system that is actually correct.
 *
 * ## Three states, two classes
 *
 * A reader can choose light, choose dark, or express no choice. The stored
 * value carries all three ("light" | "dark" | absent), but the DOM only ever
 * carries a resolved class — the boot script turns "no choice" into whatever
 * the operating system currently says. That keeps the stylesheet to one
 * definition per theme instead of a `prefers-color-scheme` copy that could
 * drift from it.
 *
 * ## Why localStorage and not a cookie
 *
 * A cookie would let the server render the right theme, but it also ships on
 * every API request and would have to be reconciled with the session. The
 * theme is a per-browser display preference and nothing on the server has any
 * use for it, so it stays in the browser. The flash a client-only choice would
 * normally cause is handled by running the resolution BEFORE first paint —
 * see `THEME_BOOT_SCRIPT`.
 */
export const THEME_STORAGE_KEY = "hrc-theme";

export type Theme = "light" | "dark";

/** Runs in `<head>`, synchronously, before the browser paints anything. */
export const THEME_BOOT_SCRIPT = `(function(){var e=document.documentElement;try{
var s=localStorage.getItem("${THEME_STORAGE_KEY}");
var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
e.classList.remove("theme-light","theme-dark");
e.classList.add(d?"theme-dark":"theme-light");
}catch(x){e.classList.add("theme-light");}})();`;

/** Broadcast when the theme changes, so subscribers re-read the document. */
export const THEME_CHANGE_EVENT = "hrc:theme";

/** Applies a theme to the document and remembers it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode, or storage disabled. The theme still applies for this
    // page; only remembering it fails, which is not worth an error state.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * `useSyncExternalStore` plumbing: the document IS the store.
 *
 * Reading the class rather than a React state means the toggle can never
 * disagree with what is on screen — including when another tab changes the
 * theme, which arrives as a `storage` event.
 */
export function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The server has no document, so it reports "unknown" and the toggle renders
 * a placeholder. Returning a guess here is what causes the wrong icon to
 * flash on load.
 */
export function serverThemeSnapshot(): null {
  return null;
}

/** What the document is showing right now — read from the DOM, not storage. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("theme-dark")
    ? "dark"
    : "light";
}
