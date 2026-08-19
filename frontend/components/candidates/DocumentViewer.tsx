"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileIcon,
} from "@/components/ui/icons";
import { DOCUMENT_STATUS_LABELS } from "@/lib/constants";
import { cn, formatFileSize } from "@/lib/utils";
import type { CandidateDocument, Citation } from "@/lib/types";

interface DocumentViewerProps {
  documents: CandidateDocument[];
  activeDocumentId: string | null;
  page: number;
  activeCitation: Citation | null;
  onSelectDocument: (documentId: string) => void;
  onChangePage: (page: number) => void;
  className?: string;
}

interface SignedUrlState {
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  message: string | null;
}

const PDF_MIME = "application/pdf";

/**
 * Renders the candidate's own document.
 *
 * The file is fetched through a short-lived signed URL minted by the backend —
 * resume files are never publicly readable, and the frontend holds no storage
 * credential. Rendering uses the browser's built-in PDF viewer via an iframe
 * with a `#page=` fragment, which gives page navigation and citation jumps
 * without shipping a multi-megabyte PDF engine to every visitor.
 *
 * Tradeoff: the `#page=` fragment is honoured by Chrome, Edge and Firefox but
 * only partially by Safari, and the embedded viewer does not report its page
 * count back to us — so the page indicator uses the backend's `pageCount`,
 * which is null until the AI service has parsed the file. DOCX has no native
 * browser renderer, so it is offered as a download instead of being rendered
 * badly; a converted preview belongs on the backend, next to the parser that
 * already reads the file.
 */
export function DocumentViewer({
  documents,
  activeDocumentId,
  page,
  activeCitation,
  onSelectDocument,
  onChangePage,
  className,
}: DocumentViewerProps) {
  const active = documents.find((doc) => doc.id === activeDocumentId) ?? null;
  const [signed, setSigned] = useState<SignedUrlState>({
    status: "idle",
    url: null,
    message: null,
  });

  // Signed URLs expire, so one is minted per document view rather than cached.
  const requestedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (requestedIdRef.current === active.id) return;
    requestedIdRef.current = active.id;

    let cancelled = false;
    setSigned({ status: "loading", url: null, message: null });

    fetch(`/api/documents/${active.id}/url`)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { url: string };
      })
      .then((body) => {
        if (cancelled) return;
        setSigned({ status: "ready", url: body.url, message: null });
      })
      .catch(() => {
        if (cancelled) return;
        setSigned({
          status: "error",
          url: null,
          message: "This document could not be opened. Try again shortly.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) {
    return (
      <div
        className={cn(
          "min-w-0 rounded-xl border border-line bg-surface shadow-card",
          className,
        )}
      >
        <EmptyState
          icon={<FileIcon className="size-5" />}
          title="No document"
          description="Upload a resume for this candidate to read it here."
        />
      </div>
    );
  }

  const isPdf = active.mimeType === PDF_MIME;
  const pageCount = active.pageCount;
  const canPage = isPdf && pageCount !== null && pageCount > 1;

  // Re-keying on the page number forces the embedded viewer to honour the new
  // fragment; browsers ignore a fragment-only change on a live iframe.
  const frameSrc =
    signed.url && isPdf ? `${signed.url}#page=${page}&view=FitH` : null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <FileIcon className="size-4 shrink-0 text-ink-subtle" />
        {documents.length > 1 ? (
          <select
            aria-label="Select document"
            value={active.id}
            onChange={(event) => onSelectDocument(event.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-[13px] font-medium text-ink outline-none"
          >
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.originalFileName}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
            {active.originalFileName}
          </span>
        )}
        {active.fileSize ? (
          <span className="hidden shrink-0 text-[12px] text-ink-muted sm:block">
            {formatFileSize(active.fileSize)}
          </span>
        ) : null}
      </div>

      <div className="relative flex min-h-96 flex-1 bg-surface-muted/60">
        {signed.status === "loading" ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="flex-1" />
          </div>
        ) : null}

        {signed.status === "error" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="flex max-w-xs items-start gap-2 text-[13px] leading-relaxed text-critical">
              <AlertIcon className="mt-px size-4 shrink-0" />
              {signed.message}
            </p>
          </div>
        ) : null}

        {signed.status === "ready" && frameSrc ? (
          <iframe
            key={`${active.id}-${page}`}
            src={frameSrc}
            title={`${active.originalFileName}, page ${page}`}
            className="size-full flex-1 border-0"
          />
        ) : null}

        {signed.status === "ready" && !isPdf ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-subtle">
              <FileIcon className="size-5" />
            </div>
            <p className="max-w-xs text-[13px] leading-relaxed text-ink-muted">
              Browsers cannot render DOCX inline. Open the file to read it — the
              extracted text and its citations still appear alongside.
            </p>
            <a
              href={signed.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-medium text-brand hover:underline"
            >
              Open {active.originalFileName}
            </a>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canPage || page <= 1}
          onClick={() => onChangePage(page - 1)}
          icon={<ChevronLeftIcon className="size-4" />}
        >
          Previous
        </Button>

        <span className="text-[12.5px] tabular-nums text-ink-muted">
          {pageCount !== null
            ? `${page} / ${pageCount}`
            : active.status === "COMPLETED"
              ? `Page ${page}`
              : DOCUMENT_STATUS_LABELS[active.status]}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canPage || (pageCount !== null && page >= pageCount)}
          onClick={() => onChangePage(page + 1)}
        >
          Next
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {activeCitation && activeCitation.documentId === active.id ? (
        <div className="border-t border-line bg-brand-soft px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
            Showing citation
            {activeCitation.page !== null ? ` · page ${activeCitation.page}` : ""}
          </p>
          <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-brand-ink">
            {activeCitation.snippet}
          </p>
        </div>
      ) : null}
    </div>
  );
}
