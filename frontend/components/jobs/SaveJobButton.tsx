"use client";

import { useState, useTransition } from "react";
import { saveJobAction, unsaveJobAction } from "@/app/(candidate)/actions";
import { CheckIcon, FileIcon, SpinnerIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

interface SaveJobButtonProps {
  slug: string;
  saved: boolean;
  className?: string;
}

/**
 * Bookmarks a job.
 *
 * Both backend routes are idempotent, so a double click cannot desynchronise
 * the state; the optimistic flip is reverted only if the call actually fails.
 */
export function SaveJobButton({ slug, saved, className }: SaveJobButtonProps) {
  const { d } = useI18n();
  const [isSaved, setIsSaved] = useState(saved);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    const next = !isSaved;
    setIsSaved(next);

    startTransition(async () => {
      const result = next
        ? await saveJobAction(slug)
        : await unsaveJobAction(slug);
      if (!result.ok) setIsSaved(!next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isSaved}
      title={isSaved ? d.jobs.unsave : d.jobs.save}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-60",
        isSaved
          ? "bg-brand-soft text-brand-ink hover:bg-brand hover:text-white"
          : "border border-line text-ink-muted hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {pending ? (
        <SpinnerIcon className="size-3.5 animate-spin" />
      ) : isSaved ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <FileIcon className="size-3.5" />
      )}
      {isSaved ? d.jobs.saved : d.jobs.save}
    </button>
  );
}
