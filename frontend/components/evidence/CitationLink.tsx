"use client";

import Link from "next/link";
import { FileIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/types";

interface CitationLinkProps {
  citation: Citation;
  /** Used on the candidate page to move the document viewer to the source. */
  onSelect?: (citation: Citation) => void;
  /** Used elsewhere (search, compare) to deep-link into the candidate page. */
  href?: string;
  active?: boolean;
  className?: string;
}

const LABEL_CLASSES =
  "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors";

export function CitationLink({
  citation,
  onSelect,
  href,
  active = false,
  className,
}: CitationLinkProps) {
  const label = (
    <>
      <FileIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        {citation.documentName} · page {citation.page}
      </span>
    </>
  );

  const classes = cn(
    LABEL_CLASSES,
    active
      ? "bg-brand text-white"
      : "bg-brand-soft text-brand-ink hover:bg-brand hover:text-white",
    className,
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(citation)}
        aria-pressed={active}
        className={classes}
        title={`Open ${citation.documentName} at page ${citation.page}`}
      >
        {label}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={classes}>
        {label}
      </Link>
    );
  }

  return (
    <span className={cn(LABEL_CLASSES, "bg-surface-muted text-ink-muted", className)}>
      {label}
    </span>
  );
}
