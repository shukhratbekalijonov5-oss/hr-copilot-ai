"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { Badge } from "@/components/ui/Badge";
import { PlanBadge } from "@/components/plan/PlanBadge";
import { ChevronDownIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import {
  allows,
  requiredPlanFor,
  type Entitlements,
} from "@/lib/entitlements/plan";
import { openNotifications } from "@/lib/ui/notifications-bus";
import type { NavSectionId, NavSectionLink } from "@/lib/workspace/primary-nav";

/**
 * The desktop dropdown behind Career, Hiring, AI Search and More.
 *
 * ## The same rows as the mobile sheet, presented for a pointer
 *
 * Both read `NavSectionLink`, so the destinations, the descriptions, the plan
 * badges and the "coming soon" mark are stated once. What differs is only
 * what a desktop can assume: the panel is anchored under its trigger instead
 * of pinned to the bottom edge, rows are 44px rather than 56px because they
 * are clicked rather than thumbed, and it closes on blur — none of which has
 * an equivalent on a phone.
 *
 * ## Hover opens it; hover is never the only way in
 *
 * Opening on hover is what makes a top bar feel quick, and it is also
 * unavailable to a keyboard, a screen reader and a touch laptop. So the
 * trigger is a real button that toggles on click and opens on ArrowDown, and
 * hover is a shortcut layered on top of that rather than the mechanism.
 *
 * ## Focus is explicit, not left to the DOM
 *
 * Arrow keys move focus between rows and Escape returns it to the trigger.
 * Without the return, dismissing a menu drops focus onto a removed element
 * and the next Tab restarts from the top of the document.
 */
export function TopNavMenu({
  id,
  label,
  description,
  links,
  entitlements,
  open,
  active,
  onOpen,
  onClose,
  onToggle,
  triggerClassName,
  indicator,
}: {
  id: NavSectionId;
  label: string;
  description: string;
  links: NavSectionLink[];
  entitlements: Entitlements;
  open: boolean;
  /** Whether the current route belongs to this area. */
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
  triggerClassName: string;
  /** The shared active underline, so links and menus mark themselves alike. */
  indicator: React.ReactNode;
}) {
  const { d } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * A pointer press anywhere else closes the menu. Registered only while it
   * is open, so a closed bar adds no document listeners at all — with four
   * menus per header that is the difference between eight idle listeners and
   * none.
   */
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  function rows(): HTMLElement[] {
    if (!panelRef.current) return [];
    return Array.from(
      panelRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
  }

  function focusRow(index: number) {
    const items = rows();
    if (items.length === 0) return;
    const wrapped = (index + items.length) % items.length;
    items[wrapped]?.focus();
  }

  function onTriggerKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      // Enter and Space also open, because the trigger is a button and the
      // browser would otherwise fire a click that toggles it shut again.
      event.preventDefault();
      if (!open) onOpen();
      // The panel mounts in this same commit; focus lands after paint.
      requestAnimationFrame(() => focusRow(0));
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onClose();
    }
  }

  function onPanelKeyDown(event: React.KeyboardEvent) {
    const items = rows();
    const current = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(current + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(current - 1);
      return;
    }
    if (event.key === "Tab") {
      // Tabbing past the last row leaves the menu, so it should not stay open
      // behind the reader. Closing on the way out matches every native menu.
      onClose();
    }
  }

  /* Per-area width. Career and Hiring carry the longest descriptions; More is
     a plain list of account pages and looks padded at anything wider. */
  const width: Record<NavSectionId, string> = {
    career: "w-[21rem]",
    hiring: "w-[21rem]",
    aiSearch: "w-[19rem]",
    more: "w-[17.5rem]",
  };

  return (
    <div
      className="relative flex h-full items-stretch"
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        /*
          `aria-current` is valid on any element. Four of the five areas are
          buttons, so without this only Home and Chats would ever announce
          themselves as the current section.
        */
        aria-current={active ? "page" : undefined}
        onClick={onToggle}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName}
      >
        {label}
        <ChevronDownIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-ink-subtle transition-transform duration-[var(--motion-fast)] ease-[var(--ease-out)]",
            open && "rotate-180",
          )}
        />
        {indicator}
      </button>

      {open ? (
        /*
          The 4px gap under the trigger is PADDING on a wrapper rather than a
          margin on the panel, so it belongs to this element's subtree.
          `mouseleave` fires only when the pointer leaves an element and all
          its descendants — as a margin, the gap would be outside both, and
          the menu would snap shut halfway through every attempt to reach it.
        */
        <div
          className={cn("absolute left-0 top-full z-40 pt-1", width[id])}
        >
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          className="animate-pop-in overflow-hidden rounded-[14px] border border-line bg-elevated p-1.5 shadow-pop"
        >
          <p className="px-2.5 pb-1.5 pt-1 text-[11.5px] leading-relaxed text-ink-subtle">
            {description}
          </p>

          {links.map((link) => {
            const rowLabel = d.nav[link.labelKey];
            const hint = d.primaryNav.hints[link.hintKey];
            const Icon = link.icon;
            const locked = Boolean(
              link.capability && !allows(entitlements, link.capability),
            );

            const body = (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-line bg-surface-muted text-ink-muted">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {rowLabel}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-ink-muted">
                    {hint}
                  </span>
                </span>
                {/* A future feature is marked BEFORE the click, not after. */}
                {link.comingSoon ? (
                  <Badge tone="neutral">{d.primaryNav.comingSoon}</Badge>
                ) : locked && link.capability ? (
                  <PlanBadge plan={requiredPlanFor(link.capability)} locked />
                ) : null}
              </>
            );

            const rowClass =
              "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left " +
              "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] " +
              "hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

            return link.href ? (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                /*
                  A locked row stays a real link. Hiding it makes a purchasable
                  feature invisible to the person who might buy it, and
                  disabling it swallows the click without explaining why — the
                  page behind it is what explains the plan.
                */
                onClick={onClose}
                className={rowClass}
              >
                {body}
              </Link>
            ) : (
              <button
                key={link.labelKey}
                type="button"
                role="menuitem"
                className={rowClass}
                onClick={() => {
                  onClose();
                  // The web has no notifications page; this opens the bell,
                  // which is the real surface.
                  if (link.opensNotifications) openNotifications();
                }}
              >
                {body}
              </button>
            );
          })}
        </div>
        </div>
      ) : null}
    </div>
  );
}
