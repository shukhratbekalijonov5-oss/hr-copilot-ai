"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  hasDismissedInstall,
  isIosSafari,
  isStandalone,
  rememberInstallDismissed,
  shouldOfferInstall,
  type BeforeInstallPromptEvent,
} from "@/lib/pwa/install";

/**
 * The install affordance, offered once and never insisted on.
 *
 * ## It cannot appear on a cold first paint
 *
 * Nothing renders until either Chromium fires `beforeinstallprompt` — which
 * it only does once it has decided the app qualifies and the reader has
 * engaged — or the reader is on iOS Safari, where the guidance is opened
 * from a menu rather than pushed at them. A first-load install modal is the
 * thing this design is built to avoid.
 *
 * ## Two platforms, two honest affordances
 *
 * Chromium can install directly, so it gets a button that installs. iOS
 * Safari exposes no such API, so it gets instructions for the Share sheet —
 * and says so plainly rather than implying a one-tap install that does not
 * exist. Neither claims anything about an App Store.
 *
 * ## Dismissal is remembered
 *
 * "Not now" means not again — a banner that returns every session is the
 * spam the brief rules out. `localStorage`, because this is a per-device
 * preference the server has no business knowing.
 */
export function InstallPrompt() {
  const { d } = useI18n();
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"prompt" | "ios-guidance" | "none">("none");

  useEffect(() => {
    function evaluate(promptAvailable: boolean) {
      setMode(
        shouldOfferInstall({
          standalone: isStandalone(),
          dismissed: hasDismissedInstall(),
          promptAvailable,
          iosSafari: isIosSafari(
            window.navigator.userAgent,
            window.navigator.maxTouchPoints,
          ),
        }),
      );
    }

    function onBeforeInstallPrompt(event: Event) {
      // Held rather than fired: the browser's own banner is suppressed so the
      // offer appears in our UI, at a moment we chose, in the reader's
      // language.
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
      evaluate(true);
    }

    function onInstalled() {
      setPrompt(null);
      setMode("none");
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // iOS never fires the event, so the initial evaluation covers it.
    evaluate(false);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /*
   * The banner is `fixed`, so without this it sits ON TOP of whatever is at
   * the end of the page — in the browser it covered the last card on both
   * dashboards. A class on the root lets one CSS rule add the matching
   * bottom padding, which is cheaper and less fragile than threading the
   * banner's height through the shell as state.
   */
  useEffect(() => {
    const root = document.documentElement;
    const open = mode !== "none";
    root.classList.toggle("install-banner-open", open);
    return () => root.classList.remove("install-banner-open");
  }, [mode]);

  if (mode === "none") return null;

  function dismiss() {
    rememberInstallDismissed();
    setMode("none");
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    // Whatever the reader chose, this offer is spent — the browser refuses
    // to fire the same event twice.
    await prompt.userChoice;
    setPrompt(null);
    setMode("none");
  }

  return (
    <div
      role="complementary"
      aria-label={d.pwa.installTitle}
      /*
        Above the bottom bar on mobile, and clear of the home indicator. It is
        `fixed` so it does not push the page, and `lg:hidden` because an
        install banner belongs where the app is installable as an app.
      */
      className="animate-pop-in fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-[16px] border border-line bg-elevated p-3.5 shadow-pop lg:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="btn-raised flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white">
          <SparkIcon className="size-4.5" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-ink">
            {mode === "prompt" ? d.pwa.installTitle : d.pwa.iosInstallTitle}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
            {mode === "prompt" ? d.pwa.installHint : d.pwa.iosInstallHint}
          </p>

          {mode === "prompt" ? (
            <Button
              size="sm"
              className="mt-2.5"
              onClick={() => void install()}
              aria-label={d.pwa.install}
            >
              {d.pwa.install}
            </Button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label={d.pwa.installDismiss}
          className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-subtle transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CloseIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
