"use client";

import Link from "next/link";
import { FileIcon, GlobeIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn, displayUrl } from "@/lib/utils";
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
 * The provenance chip under a passage.
 *
 * It must always answer "where exactly did this come from", and the answer has
 * a different shape per source kind: a file is located by page, a web page by
 * its address. So a FILE chip reads "Resume.pdf · page 2" and a URL chip reads
 * "Portfolio Website · Projects · portfolio.example.com/projects", with a
 * different icon. Collapsing both into a generic "candidate evidence" would
 * remove the one thing a citation exists to tell you.
 *
 * The page number is whatever the backend reported and is never derived on the
 * client. A computed page would look just as authoritative while sending the
 * reader to the wrong part of the document. The same holds for the URL: it is
 * copied from the retrieved chunk, never from model output.
 */
export function CitationLink({
  citation,
  onSelect,
  href,
  active = false,
  className,
}: CitationLinkProps) {
  const { d, f } = useI18n();

  const isUrl = citation.sourceType === "URL";
  const documentName =
    citation.documentName ??
    (isUrl ? d.search.sourceLink : d.search.sourceDocument);

  const detail = isUrl
    ? [citation.section, citation.sourceUrl ? displayUrl(citation.sourceUrl, 32) : null]
        .filter(Boolean)
        .join(" · ")
    : citation.page !== null
      ? `${d.common.page} ${citation.page}`
      : (citation.section ?? "");

  const label = (
    <>
      {isUrl ? (
        <GlobeIcon className="size-3.5 shrink-0" />
      ) : (
        <FileIcon className="size-3.5 shrink-0" />
      )}
      <span className="truncate">
        {documentName}
        {detail ? ` · ${detail}` : ""}
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

  // The tooltip carries the FULL url for a web citation — the visible chip is
  // elided, and a recruiter checking a claim needs to see the real address.
  const title = isUrl
    ? (citation.sourceUrl ?? f(d.evidence.openSource, { name: documentName }))
    : citation.page !== null
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
