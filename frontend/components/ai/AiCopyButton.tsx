"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, FileIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { copyToClipboard } from "@/lib/ai/clipboard";

/**
 * Copy to clipboard, with an honest answer about whether it worked.
 *
 * ## The confirmation is temporary and lives in the button
 *
 * Not a toast. A toast for something this small is noise that outlives the
 * action and stacks up if pressed twice; the label changing to "Copied" for a
 * moment is read exactly where the reader is already looking, and disappears
 * without being dismissed.
 *
 * ## Failure is shown, not swallowed
 *
 * `navigator.clipboard` is undefined outside a secure context, rejects when
 * the document is not focused, and is refused by permissions policy in an
 * embedded frame. Showing "Copied" anyway would send somebody to their email
 * with an empty clipboard — and the text they wanted is still on screen, so
 * "could not copy" costs them a manual selection rather than a mystery.
 *
 * ## Announced, not just recoloured
 *
 * The outcome goes into a polite live region so a screen-reader user learns
 * that the copy happened; the icon swap alone would tell them nothing.
 */
export function AiCopyButton({
  value,
  label,
}: {
  value: string;
  /** Accessible name — says WHAT is copied, not just "Copy". */
  label: string;
}) {
  const { d } = useI18n();
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    const ok = await copyToClipboard(
      value,
      typeof navigator === "undefined" ? undefined : navigator.clipboard,
    );
    setOutcome(ok ? "copied" : "failed");

    // One timer, replaced on each press, so pressing twice does not leave two
    // races to reset the label.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome("idle"), 2200);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={copy}
        aria-label={label}
      >
        {outcome === "copied" ? (
          <CheckIcon className="size-3.5 text-positive" aria-hidden="true" />
        ) : (
          <FileIcon className="size-3.5" aria-hidden="true" />
        )}
        {outcome === "copied" ? d.premiumAi.copied : d.premiumAi.copy}
      </Button>
      {/*
        Always present, so the region exists before it has anything to say —
        a live region inserted at the same moment as its text is frequently
        missed by screen readers.
      */}
      <span aria-live="polite" className="text-[12px] text-ink-muted">
        {outcome === "failed" ? d.premiumAi.copyFailed : ""}
      </span>
    </span>
  );
}
