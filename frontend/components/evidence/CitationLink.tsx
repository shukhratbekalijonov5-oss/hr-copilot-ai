"use client";

import Link from "next/link";
import { FileIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
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
  "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors";

/**
 * The provenance chip under a passage: file name, page, section.
 *
 * The page number is whatever the backend reported and is never derived on the
 * client. A computed page would look just as authoritative while sending the
 * reader to the wrong part of the document.
 */
export function CitationLink({
  citation,
  onSelect,
  href,
  active = false,
  className,
}: CitationLinkProps) {
  const { d, f } = useI18n();

  const documentName = citation.documentName ?? d.search.sourceDocument;

  const label = (
    <>
      <FileIcon className="size-3.5 shrink-0" />
      <span className="truncate">
        {documentName}
        {citation.page !== null ? ` · ${d.common.page} ${citation.page}` : ""}
        {citation.page === null && citation.section
          ? ` · ${citation.section}`
          : ""}
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

  const title =
    citation.page !== null
      ? f(d.evidence.openAtPage, { name: documentName, page: citation.page })
      : f(d.evidence.openDocument, { name: documentName });

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(citation)}
        aria-pressed={active}
        className={classes}
        title={title}
      >
        {label}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={classes} title={title}>
        {label}
      </Link>
    );
  }

  return (
    <span
      className={cn(LABEL_CLASSES, "bg-surface-muted text-ink-muted", className)}
    >
      {label}
    </span>
  );
}
