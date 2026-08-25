"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * List on the left, preview on the right — above `xl` only.
 *
 * ## Why `xl` and not `lg`
 *
 * A split needs roughly 1280px before both panes are genuinely usable: at
 * 1024 with a rail taking 240 of it, a 40/60 split left a list column
 * too narrow to read a job title in. Below the threshold the preview pane is
 * not rendered at all and the list becomes the whole page, with rows linking
 * through to a detail route exactly as they did before.
 *
 * ## The empty preview is a state, not a blank
 *
 * With nothing selected the right pane says so and names the next action.
 * A silently empty half-screen reads as a loading failure.
 */
export function SplitView({
  list,
  preview,
  emptyPreview,
  hasSelection,
  listLabel,
  previewLabel,
}: {
  list: ReactNode;
  preview: ReactNode;
  /** Shown in the preview pane when nothing is selected. */
  emptyPreview: ReactNode;
  hasSelection: boolean;
  listLabel: string;
  previewLabel: string;
}) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-label={listLabel} className="min-w-0">
        {list}
      </section>

      {/*
        `hidden xl:block` rather than a conditional render: the pane's
        existence is a viewport question, and keeping it in the tree means the
        selection state survives a resize across the breakpoint.
      */}
      <section
        aria-label={previewLabel}
        aria-live="polite"
        className="hidden min-w-0 xl:block"
      >
        <div
          className={cn(
            "sticky top-[4.5rem] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-[14px] border border-line bg-surface scrollbar-slim",
            !hasSelection && "grid place-items-center",
          )}
        >
          {hasSelection ? preview : emptyPreview}
        </div>
      </section>
    </div>
  );
}
