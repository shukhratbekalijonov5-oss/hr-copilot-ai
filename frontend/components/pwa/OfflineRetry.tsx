"use client";

import { buttonStyles } from "@/components/ui/Button";

/**
 * The retry control on the offline page.
 *
 * A reload rather than a router navigation: the reader is offline, so what
 * needs re-attempting is the document request itself, and the client router
 * would only re-run against the same dead network without asking the browser
 * to try the connection again.
 */
export function OfflineRetry({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={buttonStyles("secondary", "md", "mt-2")}
    >
      {label}
    </button>
  );
}
