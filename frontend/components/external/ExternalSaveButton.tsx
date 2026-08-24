"use client";

import {
  BookmarkFilledIcon,
  BookmarkIcon,
  SpinnerIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { ExternalPersonalStateApi } from "@/lib/candidate/external-personal-state";
import type { ExternalJobTracking } from "@/lib/types";

/**
 * Save / remove from saved — one control, used by the card and the panel.
 *
 * ## The state is never carried by colour alone
 *
 * A filled bookmark is the glanceable half. The other half is a real text
 * label and `aria-pressed`, because a reader with low vision, a colour
 * deficiency, or a screen reader gets nothing from a fill — and "did I save
 * this" is exactly the question they came to the control to answer. The label
 * also states what the NEXT press does once saved ("Remove from saved"), so
 * the control is not a riddle.
 *
 * ## Toggle, not two buttons
 *
 * Keeping one button in the DOM across the change is what keeps keyboard focus
 * where the reader put it. Swapping in a different element on save would drop
 * focus back to the body and lose their place in a list of fifty jobs.
 *
 * ## Prominence
 *
 * A quiet icon button, not a primary action. The primary action on an external
 * job is applying to it; saving is a bookmark, and a board where every card
 * shouts twice is a board nobody scans.
 */
export function ExternalSaveButton({
  job,
  personal,
  variant = "icon",
  className,
}: {
  job: {
    externalJobId: string;
    saved: boolean;
    tracking: ExternalJobTracking | null;
  };
  personal: ExternalPersonalStateApi;
  /** `icon` on cards; `full` in the panel, where there is room for the word. */
  variant?: "icon" | "full";
  className?: string;
}) {
  const { d } = useI18n();

  const state = personal.stateFor(job);
  const busy = personal.isBusy(job.externalJobId);
  const error = personal.errorFor(job.externalJobId);
  const saveError = error === "save" || error === "unsave";

  // What the control DOES on the next press — which is what a button's
  // accessible name should say.
  const actionLabel = state.saved ? d.externalJobs.unsave : d.externalJobs.save;
  // What is true right now — shown as the visible word in the wide variant.
  const stateLabel = state.saved ? d.externalJobs.savedState : d.externalJobs.save;

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <button
        type="button"
        // `aria-pressed` is the state; the label is the action. Together a
        // screen reader announces "Remove from saved, pressed" — which answers
        // both questions in one breath.
        aria-pressed={state.saved}
        aria-label={variant === "icon" ? actionLabel : undefined}
        title={actionLabel}
        disabled={busy}
        onClick={() => personal.toggleSaved(job)}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border text-[12.5px] font-medium transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          "disabled:cursor-not-allowed disabled:opacity-60",
          variant === "icon" ? "size-8" : "h-9.5 px-3.5",
          state.saved
            ? "border-brand-soft bg-brand-soft text-brand-ink hover:bg-brand-soft/70"
            : "border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink",
        )}
      >
        {busy ? (
          <SpinnerIcon className="size-4 animate-spin" />
        ) : state.saved ? (
          <BookmarkFilledIcon className="size-4" />
        ) : (
          <BookmarkIcon className="size-4" />
        )}
        {variant === "full" ? <span>{stateLabel}</span> : null}
      </button>

      {/*
        Announced politely rather than shouted: the control has already
        reverted to its previous state, so the reader can see nothing changed —
        this says why. `role="status"` so a screen reader hears it without
        losing their place.
      */}
      {saveError ? (
        <p role="status" className="text-[11.5px] leading-snug text-critical">
          {error === "save"
            ? d.externalJobs.saveFailed
            : d.externalJobs.unsaveFailed}
        </p>
      ) : null}
    </div>
  );
}
