"use client";

import { useEffect } from "react";
import { SERVICE_WORKER_URL } from "@/lib/pwa/config";

/**
 * Registers the service worker. Renders nothing.
 *
 * ## After hydration, and never before
 *
 * Registration competes with the first paint for network and main-thread
 * time, and nothing on the first screen needs it. Doing it in an effect means
 * the worker is installed for the SECOND visit, which is the only visit it
 * can help anyway.
 *
 * ## Failure is silent on purpose
 *
 * A worker that will not register — an unsupported browser, a private
 * window, an insecure origin, a corporate policy — costs the reader nothing:
 * the app is fully functional without it, since it is not offline-first. An
 * error toast would be reporting a problem they cannot act on and do not
 * have.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    /*
     * Service workers require a secure context. `localhost` counts as one,
     * so development still exercises this path — but a staging box served
     * over plain http would throw here rather than register, and the guard
     * keeps that out of the console.
     */
    if (!window.isSecureContext) return;

    void navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
      // Deliberately swallowed — see above.
    });
  }, []);

  return null;
}
