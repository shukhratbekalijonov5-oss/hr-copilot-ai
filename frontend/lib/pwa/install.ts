/**
 * Install-prompt state, as pure functions.
 *
 * Kept out of the component so the rules — when to offer, when to stay quiet,
 * which platform gets which affordance — can be tested directly instead of
 * through a rendered banner.
 */

/** The Chromium-only event. Not in TypeScript's DOM lib, so it is declared. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const INSTALL_DISMISSED_KEY = "hrc-install-dismissed";

/**
 * Whether the app is already running as an installed app.
 *
 * Two checks because the platforms disagree: Chromium and the spec use the
 * `display-mode` media query, while iOS Safari sets a non-standard
 * `navigator.standalone` and does not implement the query for home-screen
 * launches. Checking only one would show an install prompt inside the
 * installed app on whichever platform was missed.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return Boolean(displayMode || iosStandalone);
}

/**
 * Whether this is iOS Safari, which has no install prompt to fire.
 *
 * iPadOS reports itself as a Mac, so a touch check separates a real iPad from
 * a desktop Safari — without it, a laptop would be told to use a Share sheet
 * it does not have.
 */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  /*
   * Any browser that is not Safari is excluded first.
   *
   * The Macintosh-plus-touch heuristic below is how an iPad is recognised —
   * iPadOS reports a desktop UA — but on its own it also matches a desktop
   * Chrome with touch emulation on, which then gets told to use a Share
   * sheet it does not have. The browser pass caught exactly that. Real
   * Safari's UA carries no `Chrome`, `CriOS`, `FxiOS` or `EdgiOS` token, and
   * the iOS Chrome/Firefox builds cannot install anything anyway.
   */
  if (/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(userAgent)) return false;

  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

export function hasDismissedInstall(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    // Private mode or storage disabled. Treating that as "not dismissed"
    // would re-offer on every load, so it is treated as dismissed.
    return true;
  }
}

export function rememberInstallDismissed(): void {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {
    // Nothing to do; the banner simply reappears next session.
  }
}

/**
 * Whether to offer installation at all.
 *
 * ## Quiet by default
 *
 * The brief says not to spam an install modal on first load, and the rule
 * that achieves it is this: something must have HAPPENED first. On Chromium
 * that is the browser deciding the app qualifies and firing its event; on iOS
 * it is the reader opening the More menu. Neither fires on a cold first
 * paint, so nobody is interrupted before they have seen the product.
 */
export function shouldOfferInstall(state: {
  standalone: boolean;
  dismissed: boolean;
  promptAvailable: boolean;
  iosSafari: boolean;
}): "prompt" | "ios-guidance" | "none" {
  // Already installed: there is nothing to offer, on any platform.
  if (state.standalone) return "none";
  if (state.dismissed) return "none";
  if (state.promptAvailable) return "prompt";
  if (state.iosSafari) return "ios-guidance";
  return "none";
}
