"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ProcessingChannel } from "@/lib/api";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import { cn, formatFileSize, pluralize } from "@/lib/utils";
import type { UploadItem } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { ProcessingStatusBadge } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProcessingProgress } from "@/components/processing/ProcessingProgress";
import {
  AlertIcon,
  CloseIcon,
  FileIcon,
  UploadIcon,
} from "@/components/ui/icons";

interface RejectedFile {
  fileName: string;
  reason: string;
}

interface ResumeUploaderProps {
  vacancyId?: string | null;
  className?: string;
  /** Fires whenever the queue changes, so a page can react to completion. */
  onQueueChange?: (items: UploadItem[]) => void;
}

function validate(file: File): string | null {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!(ACCEPTED_RESUME_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Unsupported format (${extension || "unknown"}). Upload PDF or DOCX.`;
  }
  if (file.size > MAX_RESUME_SIZE_BYTES) {
    return `Larger than ${formatFileSize(MAX_RESUME_SIZE_BYTES)}.`;
  }
  if (file.size === 0) {
    return "File is empty.";
  }
  return null;
}

export function ResumeUploader({
  vacancyId = null,
  className,
  onQueueChange,
}: ResumeUploaderProps) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const channelsRef = useRef<ProcessingChannel[]>([]);

  useEffect(() => {
    const channels = channelsRef.current;
    return () => {
      channels.forEach((channel) => channel.close());
    };
  }, []);

  useEffect(() => {
    onQueueChange?.(items);
  }, [items, onQueueChange]);

  const addFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      const accepted: File[] = [];
      const failures: RejectedFile[] = [];

      for (const file of files) {
        const reason = validate(file);
        if (reason) {
          failures.push({ fileName: file.name, reason });
        } else {
          accepted.push(file);
        }
      }

      setRejected(failures);
      setError(null);

      if (accepted.length === 0) return;

      setUploading(true);
      try {
        const queued = await api.uploadResumes({ files: accepted, vacancyId });
        setItems((current) => [...current, ...queued]);

        // Replace this with a WebSocket subscription once the worker exposes one.
        const channel = api.openProcessingChannel(queued, (event) => {
          setItems((current) =>
            current.map((item) =>
              item.id === event.uploadId
                ? {
                    ...item,
                    status: event.status,
                    progress: event.progress,
                    error: event.error,
                  }
                : item,
            ),
          );
        });
        channelsRef.current.push(channel);
      } catch {
        setError("Upload failed. Check your connection and try again.");
      } finally {
        setUploading(false);
      }
    },
    [vacancyId],
  );

  const summary = api.summarizeUploads(items);
  const done = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;

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
          Drag resumes here, or browse
        </p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          PDF or DOCX, up to {formatFileSize(MAX_RESUME_SIZE_BYTES)} each.
          Multiple files supported.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          Select files
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

      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {rejected.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-[12.5px] font-semibold text-ink">
            {rejected.length} {pluralize(rejected.length, "file")} skipped
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
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Pipeline</h3>
              <p className="text-[12.5px] text-ink-muted tabular-nums">
                {done} of {items.length} indexed
                {failed > 0 ? ` · ${failed} failed` : ""}
              </p>
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
                  <ProcessingStatusBadge status={item.status} />
                  <button
                    type="button"
                    aria-label={`Remove ${item.fileName} from the queue`}
                    onClick={() =>
                      setItems((current) =>
                        current.filter((entry) => entry.id !== item.id),
                      )
                    }
                    className="rounded p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                  >
                    <CloseIcon className="size-3.5" />
                  </button>
                </div>
                <ProgressBar
                  value={item.progress}
                  tone={item.status === "failed" ? "critical" : "brand"}
                  label={`${item.fileName} progress`}
                  className="mt-2"
                />
                {item.error ? (
                  <p className="mt-1.5 text-[12px] text-critical">{item.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
