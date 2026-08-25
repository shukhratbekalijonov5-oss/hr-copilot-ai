import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { OfflineRetry } from "@/components/pwa/OfflineRetry";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.pwa.offlineTitle };
}

/**
 * What a reader sees when a navigation fails with no network.
 *
 * ## It claims nothing about the product's data
 *
 * The copy says the connection is gone and that nothing updates while it is —
 * it does not show a cached shortlist, a stale unread count or yesterday's
 * matches dressed as current. Everything this app is for is server state that
 * is wrong the moment it is stale, so the honest offline screen is an empty
 * one with an explanation.
 *
 * ## Statically rendered, deliberately
 *
 * The service worker caches this at install time, which only works if it is a
 * plain static page. It reads the dictionary at build time and calls no API —
 * a page that needed the network to explain the network being down would be
 * the one page guaranteed to fail.
 */
export default async function OfflinePage() {
  const d = await getTranslations();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-[16px] border border-line bg-surface-muted text-ink-subtle"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          className="size-7"
        >
          <path d="M3 3l18 18" />
          <path d="M10.7 5.1a11 11 0 0 1 10.2 3.3M2.5 8.5a11 11 0 0 1 4-2.6" />
          <path d="M5.8 12a7 7 0 0 1 2.4-1.6m6.3-.1a7 7 0 0 1 3.7 1.7" />
          <path d="M9 15.4a3 3 0 0 1 4.3.6" />
          <path d="M12 19h.01" />
        </svg>
      </span>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
        {d.pwa.offlineTitle}
      </h1>
      <p className="text-[14px] leading-relaxed text-ink-muted">
        {d.pwa.offlineHint}
      </p>

      <OfflineRetry label={d.pwa.offlineRetry} />
    </main>
  );
}
