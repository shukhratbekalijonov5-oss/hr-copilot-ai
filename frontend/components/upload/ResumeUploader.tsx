"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useResumeUpload } from "@/lib/hooks/useResumeUpload";
import { useProcessingStream } from "@/lib/hooks/useProcessingStream";
import { summarizeDocumentStatuses } from "@/lib/api/adapters";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import { useI18n } from "@/lib/i18n/context";
import { localizedDocumentError } from "@/lib/documents/errors";
import { cn, formatFileSize } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProcessingProgress } from "@/components/processing/ProcessingProgress";
import { StreamStatusPill } from "@/components/processing/StreamStatusPill";
import { CloseIcon, FileIcon, UploadIcon } from "@/components/ui/icons";

interface ResumeUploaderProps {
  /** Attaches uploads to a candidate. Without it the API stores them unlinked. */
  candidateId?: string | null;
  className?: string;
}

/**
 * Browser → Next → NestJS → storage → BullMQ.
 *
 * Files are posted to this app's own route so the session cookie authenticates
 * them; the frontend never talks to storage or the AI service directly.
 */
export function ResumeUploader({
  candidateId = null,
  className,
}: ResumeUploaderProps) {
  const router = useRouter();
  const { d, f, p } = useI18n();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { items, rejected, busy, addFiles, applyEvent, remove, clear } =
    useResumeUpload({
      candidateId,
      formatError: (error) =>
        localizedDocumentError(error.code, d, error.message),
      // New documents change server-rendered lists on the page.
      onUploaded: () => router.refresh(),
    });

  const streamStatus = useProcessingStream({
    onEvent: applyEvent,
    // Progress that arrived while the stream was down is recovered from the
    // server rather than left stale.
    onResync: () => router.refresh(),
    enabled: items.length > 0,
  });

  const summary = summarizeDocumentStatuses(items.map((item) => item.status));
  const done = items.filter((item) => item.status === "COMPLETED").length;
  const failed = items.filter((item) => item.status === "FAILED").length;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles(event.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging
            ? "border-brand bg-brand-soft"
            : "border-line bg-surface-muted/40 hover:border-line-strong",
        )}
      >
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted">
          <UploadIcon className="size-5" />
        </div>
        <p className="mt-3 text-sm font-medium text-ink">
          {d.uploader.dragOrBrowse}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {f(d.uploader.sizeHint, {
            size: formatFileSize(MAX_RESUME_SIZE_BYTES),
          })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          loading={busy}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? d.uploader.uploading : d.uploader.selectFiles}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_RESUME_EXTENSIONS.join(",")}
          className="sr-only"
          onChange={(event) => {
            void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {rejected.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-[12.5px] font-semibold text-ink">
            {p(d.uploader.skipped, rejected.length)}
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {rejected.map((file) => (
              <li
                key={file.fileName}
                className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-muted"
              >
                <span className="font-medium text-ink">{file.fileName}</span>
                <span className="text-critical">{file.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {d.uploader.pipeline}
              </h3>
              <div className="flex items-center gap-2">
                <StreamStatusPill status={streamStatus} />
                <p className="text-[12.5px] tabular-nums text-ink-muted">
                  {f(d.uploader.indexedOf, { done, total: items.length })}
                  {failed > 0
                    ? f(d.uploader.failedSuffix, { count: failed })
                    : ""}
                </p>
              </div>
            </div>
            <ProcessingProgress summary={summary} />
          </div>

          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-line bg-surface px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <FileIcon className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                    {item.fileName}
                  </span>
                  <span className="hidden text-[12px] text-ink-muted sm:block">
                    {formatFileSize(item.sizeBytes)}
                  </span>
                  <DocumentStatusBadge status={item.status} />
                  <button
                    type="button"
                    aria-label={f(d.uploader.removeFromList, { name: item.fileName })}
                    onClick={() => remove(item.id)}
                    className="rounded p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                  >
                    <CloseIcon className="size-3.5" />
                  </button>
                </div>
                <ProgressBar
                  value={item.progress}
                  tone={item.status === "FAILED" ? "critical" : "brand"}
                  label={f(d.uploader.progressLabel, { name: item.fileName })}
                  className="mt-2"
                />
                {item.error ? (
                  <p role="alert" className="mt-1.5 text-[12px] text-critical">
                    {item.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={clear}
          >
            {d.uploader.clearList}
          </Button>
        </>
      ) : null}
    </div>
  );
}
