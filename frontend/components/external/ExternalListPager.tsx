"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Previous / Next over a candidate-owned external list.
 *
 * ## The page lives in the URL
 *
 * Same rule the search page follows: a page is a real address, so it survives
 * a refresh, works with the back button, and can be shared. That also means
 * the pager is two `<Link>`s and not two buttons holding client state — a
 * boundary press is simply an absent link, which is unclickable for a mouse
 * AND untabbable for a keyboard, rather than a button that looks pressable and
 * silently does nothing.
 *
 * ## It preserves everything else in the query
 *
 * The tracked list can be narrowed to one status. Paging must not quietly
 * widen it back, so the pager rebuilds the URL from the params it was given
 * and changes only `page`.
 */
export function ExternalListPager({
  pathname,
  page,
  totalPages,
  /** Every other search param to carry across, e.g. the status filter. */
  params,
}: {
  pathname: string;
  page: number;
  totalPages: number;
  params?: Record<string, string | undefined>;
}) {
  const { d, f } = useI18n();

  if (totalPages <= 1) return null;

  const href = (next: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) query.set(key, value);
    }
    // Page 1 is the bare URL: a shared link should not carry `?page=1`.
    if (next > 1) query.set("page", String(next));
    const search = query.toString();
    return search ? `${pathname}?${search}` : pathname;
  };

  /*
   * A hand-edited `?page=99` on a two-page list must not render "99 / 2".
   * Clamping to the real range makes the pager describe where the reader
   * actually is — the last page — and gives Previous somewhere sensible to go.
   * The empty state above says separately that this page holds nothing.
   */
  const current = Math.min(Math.max(1, page), totalPages);
  const atStart = current <= 1;
  const atEnd = current >= totalPages;

  return (
    <nav
      aria-label={d.common.pagination}
      className="flex items-center justify-between gap-2"
    >
      {atStart ? (
        <span
          aria-disabled="true"
          className={cn(buttonStyles("secondary", "sm"), "pointer-events-none opacity-50")}
        >
          {d.common.previous}
        </span>
      ) : (
        <Link href={href(current - 1)} className={buttonStyles("secondary", "sm")}>
          {d.common.previous}
        </Link>
      )}

      <span aria-live="polite" className="text-[12.5px] tabular-nums text-ink-muted">
        {f(d.common.pageOf, { page: current, total: totalPages })}
      </span>

      {atEnd ? (
        <span
          aria-disabled="true"
          className={cn(buttonStyles("secondary", "sm"), "pointer-events-none opacity-50")}
        >
          {d.common.next}
        </span>
      ) : (
        <Link href={href(current + 1)} className={buttonStyles("secondary", "sm")}>
          {d.common.next}
        </Link>
      )}
    </nav>
  );
}
