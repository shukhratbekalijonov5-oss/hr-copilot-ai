"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * A right-side contextual panel.
 *
 * ## Why a drawer rather than navigation
 *
 * Opening a citation used to mean leaving the answer that cited it. A drawer
 * keeps the claim and its source on screen together, which is the whole point
 * of provenance — a reader checking evidence is comparing, not browsing.
 *
 * ## Focus is moved in and handed back
 *
 * Opening focuses the panel so keyboard and screen-reader users land inside
 * it instead of continuing through the page behind; closing returns focus to
 * whatever opened it. Escape closes. Without the return, dismissing a drawer
 * strands focus on an element that no longer exists.
 *
 * ## It does not take the page over on desktop
 *
 * The backdrop is opaque enough to focus attention but the panel is a fixed
 * width, so the workspace behind stays visible and the drawer reads as an
 * inspector rather than a modal detour. On narrow screens it becomes
 * full-width, where a 420px panel would leave an unusable sliver.
 */
export function SideDrawer({
  open,
  title,
  description,
  onClose,
  footer,
  children,
  className,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
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
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label={d.common.close}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "animate-drawer-in relative flex h-dvh w-full flex-col border-l border-line bg-surface shadow-pop",
          "sm:w-[26rem] lg:w-[28rem]",
          "focus-visible:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-[15px] font-semibold tracking-tight text-ink"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={d.common.close}
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted hover:text-ink"
          >
            <CloseIcon className="size-4.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-slim">
          {children}
        </div>

        {footer ? (
          <div className="border-t border-line px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
