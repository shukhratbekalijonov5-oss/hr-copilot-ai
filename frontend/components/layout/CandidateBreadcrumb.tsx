"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRightIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  PERSONAL_NAV,
  PERSONAL_SECONDARY_NAV,
  isNavItemActive,
} from "@/lib/workspace/navigation";

/**
 * Where the reader is, in the header.
 *
 * The job-seeker side has one workspace, so the workspace switcher the
 * recruiting side shows here would be a control with nothing to switch. A
 * breadcrumb uses the same space to answer a question a reader actually has —
 * which area of the product am I in — and it is derived from the SAME nav
 * definition the sidebar renders, so the two can never disagree.
 *
 * The area is a heading, not a link: areas have no page of their own, and a
 * crumb that navigates nowhere is worse than one that plainly does not.
 */
export function CandidateBreadcrumb() {
  const pathname = usePathname();
  const { d } = useI18n();

  const current =
    [...PERSONAL_NAV, ...PERSONAL_SECONDARY_NAV].find((item) =>
      isNavItemActive(pathname, item.href),
    ) ?? null;

  if (!current) return null;

  const area = current.groupKey ? d.nav[current.groupKey] : null;
  const label = d.nav[current.labelKey];

  return (
    <nav aria-label={d.nav.breadcrumb} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <li className="hidden shrink-0 sm:block">
          <Link
            href="/home"
            className="text-ink-muted transition-colors duration-[var(--motion-fast)] hover:text-ink"
          >
            {d.meta.appName}
          </Link>
        </li>
        {area ? (
          <>
            <li aria-hidden="true" className="hidden shrink-0 sm:block">
              <ChevronRightIcon className="size-3.5 text-ink-subtle" />
            </li>
            <li className="hidden shrink-0 text-ink-muted sm:block">{area}</li>
          </>
        ) : null}
        <li aria-hidden="true" className="hidden shrink-0 sm:block">
          <ChevronRightIcon className="size-3.5 text-ink-subtle" />
        </li>
        <li className="min-w-0">
          <span
            aria-current="page"
            className="block truncate font-medium text-ink"
          >
            {label}
          </span>
        </li>
      </ol>
    </nav>
  );
}
