"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { PlanBadge } from "@/components/plan/PlanBadge";
import { CloseIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { allows, requiredPlanFor, type Entitlements } from "@/lib/entitlements/plan";
import { openNotifications } from "@/lib/ui/notifications-bus";
import type { NavSectionLink } from "@/lib/workspace/primary-nav";

/**
 * The bottom sheet behind Career, Hiring, AI Search and More.
 *
 * ## No dependency
 *
 * These sheets present three to five links. A gesture-driven sheet library
 * would add a package and an animation budget to solve what a fixed panel
 * already solves; dismissal is by backdrop tap, Escape and a labelled close
 * button — three affordances, none needing a pan handler.
 *
 * ## Focus is moved and returned
 *
 * Opening focuses the panel so a keyboard or screen-reader user lands inside
 * it rather than continuing through the page behind; closing returns focus to
 * whatever opened it. Without that, "Escape" leaves focus stranded on a
 * dismissed element, which is the most common way a custom sheet breaks
 * keyboard navigation.
 */
export function MobileSheet({
  open,
  title,
  description,
  links,
  entitlements,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  links: NavSectionLink[];
  entitlements: Entitlements;
  onClose: () => void;
}) {
  const { d } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="presentation">
      <button
        type="button"
        aria-label={d.primaryNav.close}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-pop-in relative w-full rounded-t-[20px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop focus-visible:outline-none"
      >
        {/* Decorative grab handle; the real affordances are labelled. */}
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>

        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={d.primaryNav.close}
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </div>

        <ul className="max-h-[60dvh] overflow-y-auto px-2.5 pb-4 scrollbar-slim">
          {links.map((link) => {
            const label = d.nav[link.labelKey];
            const hint = d.primaryNav.hints[link.hintKey];
            const Icon = link.icon;
            const locked = Boolean(
              link.capability && !allows(entitlements, link.capability),
            );

            const body = (
              <>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface-muted text-ink-muted">
                  <Icon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium text-ink">
                    {label}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                    {hint}
                  </span>
                </span>
                {/* A future feature is marked BEFORE the tap, not after it. */}
                {link.comingSoon ? (
                  <Badge tone="neutral">{d.primaryNav.comingSoon}</Badge>
                ) : locked && link.capability ? (
                  <PlanBadge plan={requiredPlanFor(link.capability)} locked />
                ) : null}
              </>
            );

            const rowClass =
              "flex min-h-[56px] w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted active:bg-surface-muted";

            return (
              <li key={link.href ?? link.labelKey}>
                {link.href ? (
                  <Link href={link.href} onClick={onClose} className={rowClass}>
                    {body}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className={rowClass}
                    onClick={() => {
                      onClose();
                      // The web has no notifications page; this opens the
                      // header's bell, which is the real surface.
                      if (link.opensNotifications) openNotifications();
                    }}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
