"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import {
  AlertIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  currentDocumentPreviewPath,
  currentDocumentUrlPath,
  isPdfMimeType,
  isSameDocumentPreview,
  pdfFrameSource,
} from "@/lib/documents/pdf-preview";
import { cn, formatFileSize } from "@/lib/utils";
import type { CandidateDocument, Citation } from "@/lib/types";

interface DocumentViewerProps {
  /**
   * The applicant's CURRENT documents — the only document truth. A citation
   * naming a source that is no longer here simply does not resolve; deleted
   * files are not resurrected for display.
   */
  documents: CandidateDocument[];
  /** The applicant whose current file is being read. */
  candidateId: string;
  /** The owned-vacancy context every fetch is re-authorized under. */
  vacancyId: string;
  activeDocumentId: string | null;
  page: number;
  activeCitation: Citation | null;
  onSelectDocument: (documentId: string) => void;
  onChangePage: (page: number) => void;
  className?: string;
}

interface SignedUrlState {
  documentId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  message: string | null;
}

interface PdfPreviewState {
  documentId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  url: string | null;
  message: string | null;
}

/**
 * Renders the candidate's own document.
 *
 * The file is fetched through a frontend-owned preview route which mints a
 * short-lived signed URL server-side and streams the bytes back through this
 * app's origin. Resume files are never publicly readable, and the browser never
 * receives a storage credential or the signed backend URL.
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
  candidateId,
  vacancyId,
  activeDocumentId,
  page,
  activeCitation,
  onSelectDocument,
  onChangePage,
  className,
}: DocumentViewerProps) {
  const { d, f } = useI18n();
  const active = documents.find((doc) => doc.id === activeDocumentId) ?? null;
  const activeId = active?.id ?? null;
  /** The picker offers exactly the current files — unique ids, up to 3. */
  const options = documents;
  const isPdf = isPdfMimeType(active?.mimeType);
  const [signed, setSigned] = useState<SignedUrlState>({
    documentId: null,
    status: "idle",
    url: null,
    message: null,
  });
  const [pdfPreview, setPdfPreview] = useState<PdfPreviewState>({
    documentId: null,
    status: "idle",
    url: null,
    message: null,
  });

  useEffect(() => {
    if (!activeId || isPdf) return;

    let cancelled = false;

    fetch(currentDocumentUrlPath(candidateId, vacancyId, activeId))
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { url: string };
      })
      .then((body) => {
        if (cancelled) return;
        setSigned({
          documentId: activeId,
          status: "ready",
          url: body.url,
          message: null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSigned({
          documentId: activeId,
          status: "error",
          url: null,
          message: d.candidates.documentOpenFailed,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [activeId, candidateId, vacancyId, d.candidates.documentOpenFailed, isPdf]);

  useEffect(() => {
    if (!activeId || !isPdf) return;

    const documentId = activeId;
    const controller = new AbortController();
    let cancelled = false;
    let timedOut = false;
    let objectUrl: string | null = null;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
      setPdfPreview({
        documentId,
        status: "error",
        url: null,
        message: d.candidates.documentOpenFailed,
      });
    }, 15000);

    fetch(currentDocumentPreviewPath(candidateId, vacancyId, documentId), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const blob = await response.blob();
        window.clearTimeout(timeout);
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPdfPreview({
          documentId,
          status: "loading",
          url: objectUrl,
          message: null,
        });
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          timedOut ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        window.clearTimeout(timeout);
        setPdfPreview({
          documentId,
          status: "error",
          url: null,
          message: d.candidates.documentOpenFailed,
        });
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeId, candidateId, vacancyId, d.candidates.documentOpenFailed, isPdf]);

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
          title={d.candidates.noDocument}
          description={d.candidates.noDocumentHint}
        />
      </div>
    );
  }

  const pageCount = active.pageCount;
  const canPage = isPdf && pageCount !== null && pageCount > 1;
  const previewPath = currentDocumentPreviewPath(
    candidateId,
    vacancyId,
    active.id,
  );
  const previewForActive = isSameDocumentPreview(
    pdfPreview.documentId,
    active.id,
  )
    ? pdfPreview
    : { documentId: active.id, status: "loading", url: null, message: null };
  const signedForActive = isSameDocumentPreview(signed.documentId, active.id)
    ? signed
    : { documentId: active.id, status: "loading", url: null, message: null };

  // Re-keying on the page number forces the embedded viewer to honour the new
  // fragment; browsers ignore a fragment-only change on a live iframe.
  const frameSrc =
    previewForActive.url && isPdf
      ? pdfFrameSource(previewForActive.url, page)
      : null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <FileIcon className="size-4 shrink-0 text-ink-subtle" />
        {options.length > 1 ? (
          <select
            aria-label={d.candidates.selectDocument}
            value={active.id}
            onChange={(event) => onSelectDocument(event.target.value)}
            className="min-w-0 flex-1 truncate bg-transparent text-[13px] font-medium text-ink outline-none"
          >
            {options.map((document) => (
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
        {isPdf && previewForActive.status === "loading" ? (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 bg-surface-muted/90 p-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="flex-1" />
          </div>
        ) : null}

        {isPdf && previewForActive.status === "error" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex max-w-xs flex-col items-center gap-3 text-center">
              <p className="flex items-start gap-2 text-[13px] leading-relaxed text-critical">
                <AlertIcon className="mt-px size-4 shrink-0" />
                {previewForActive.message ?? d.candidates.previewUnavailable}
              </p>
              <a
                href={previewPath}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-brand hover:underline"
              >
                {d.candidates.openPdf}
              </a>
            </div>
          </div>
        ) : null}

        {isPdf && previewForActive.status !== "error" && frameSrc ? (
          <iframe
            key={`${active.id}-${page}`}
            src={frameSrc}
            title={f(d.evidence.openAtPage, {
              name: active.originalFileName,
              page,
            })}
            onLoad={() =>
              setPdfPreview((current) =>
                current.documentId === active.id
                  ? { ...current, status: "ready" }
                  : current,
              )
            }
            onError={() =>
              setPdfPreview({
                documentId: active.id,
                status: "error",
                url: null,
                message: d.candidates.documentOpenFailed,
              })
            }
            className={cn(
              "size-full flex-1 border-0",
              previewForActive.status === "ready" ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}

        {!isPdf && signedForActive.status === "loading" ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="flex-1" />
          </div>
        ) : null}

        {!isPdf && signedForActive.status === "error" ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="flex max-w-xs items-start gap-2 text-[13px] leading-relaxed text-critical">
              <AlertIcon className="mt-px size-4 shrink-0" />
              {signedForActive.message}
            </p>
          </div>
        ) : null}

        {!isPdf && signedForActive.status === "ready" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-subtle">
              <FileIcon className="size-5" />
            </div>
            <p className="max-w-xs text-[13px] leading-relaxed text-ink-muted">
              {d.candidates.docxNotRenderable}
            </p>
            <a
              href={signedForActive.url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-medium text-brand hover:underline"
            >
              {f(d.candidates.openFile, { name: active.originalFileName })}
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
          {d.common.previous}
        </Button>

        <span className="text-[12.5px] tabular-nums text-ink-muted">
          {pageCount !== null
            ? f(d.common.pageOf, { page, total: pageCount })
            : active.status === "COMPLETED"
              ? f(d.common.pageNumber, { page })
              : d.status.document[active.status]}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canPage || (pageCount !== null && page >= pageCount)}
          onClick={() => onChangePage(page + 1)}
        >
          {d.common.next}
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      {activeCitation && activeCitation.documentId === active.id ? (
        <div className="border-t border-line bg-brand-soft px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
            {d.candidates.showingCitation}
            {activeCitation.page !== null
              ? ` · ${d.common.page} ${activeCitation.page}`
              : ""}
          </p>
          <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-brand-ink">
            {activeCitation.snippet}
          </p>
        </div>
      ) : null}
    </div>
  );
}
