"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { AlertIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * A confirmation for something that cannot be undone.
 *
 * Used where the consequence reaches beyond the current screen — deleting a
 * piece of evidence also removes it from recruiters' analysis of applications
 * already sent — so `consequence` is a required prop rather than an optional
 * flourish: a dialog that only asks "are you sure?" tells the person nothing
 * they did not already know.
 */
export function ConfirmDialog({
  open,
  title,
  question,
  consequence,
  confirmLabel,
  error,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  question: string;
  /** What else this affects. Shown prominently; never omitted. */
  consequence: string;
  confirmLabel: string;
  error?: string | null;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { d } = useI18n();

  // Escape closes. (Focus lands on the SAFE choice via autoFocus below — a
  // destructive action should never be one stray Enter away.)
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-critical-soft text-critical">
            <AlertIcon className="size-4.5" />
          </span>
          <div className="min-w-0">
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold tracking-tight text-ink"
            >
              {title}
            </h2>
            <div id="confirm-dialog-body">
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                {question}
              </p>
              <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-warning">
                {consequence}
              </p>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-[13px] text-critical">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            autoFocus
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={onCancel}
          >
            {d.common.cancel}
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
