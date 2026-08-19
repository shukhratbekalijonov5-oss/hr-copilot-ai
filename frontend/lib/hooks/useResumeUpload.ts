"use client";

import { useCallback, useRef, useState } from "react";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import { formatFileSize } from "@/lib/utils";
import type { CandidateDocument, DocumentStatus, UploadItem } from "@/lib/types";

export interface RejectedFile {
  fileName: string;
  reason: string;
}

/** Client-side pre-check. The backend re-validates, including magic numbers. */
export function validateResumeFile(file: File): string | null {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!(ACCEPTED_RESUME_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Unsupported format (${extension || "unknown"}). Upload PDF or DOCX.`;
  }
  if (file.size === 0) return "File is empty.";
  if (file.size > MAX_RESUME_SIZE_BYTES) {
    return `Larger than ${formatFileSize(MAX_RESUME_SIZE_BYTES)}.`;
  }
  return null;
}

/**
 * Posts one file to this app's upload route and reports byte progress.
 *
 * XHR rather than fetch: `upload.onprogress` is the only way to show real
 * transfer progress, and a large resume over a slow link otherwise looks stuck.
 */
function uploadOne(
  file: File,
  candidateId: string | null,
  onProgress: (percent: number) => void,
): Promise<CandidateDocument> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", file);
    if (candidateId) body.append("candidateId", candidateId);
    body.append("type", "RESUME");

    const request = new XMLHttpRequest();
    request.open("POST", "/api/uploads");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        // Handled below by the status check.
      }

      if (request.status >= 200 && request.status < 300 && payload) {
        resolve(payload as CandidateDocument);
        return;
      }

      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message: unknown }).message)
          : "Upload failed.";
      reject(new Error(message));
    };

    request.onerror = () =>
      reject(new Error("Could not reach the server. Check your connection."));
    request.onabort = () => reject(new Error("Upload cancelled."));

    request.send(body);
  });
}

interface UseResumeUploadOptions {
  candidateId?: string | null;
  onUploaded?: () => void;
}

export function useResumeUpload({
  candidateId = null,
  onUploaded,
}: UseResumeUploadOptions = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [busy, setBusy] = useState(false);

  // Maps backend documentId → queue row, so streamed events find their row.
  const byDocumentId = useRef(new Map<string, string>());

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    );
  }, []);

  const addFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const accepted: File[] = [];
      const failures: RejectedFile[] = [];

      for (const file of files) {
        const reason = validateResumeFile(file);
        if (reason) failures.push({ fileName: file.name, reason });
        else accepted.push(file);
      }

      setRejected(failures);
      if (accepted.length === 0) return;

      const queued: UploadItem[] = accepted.map((file, index) => ({
        id: `upl-${Date.now().toString(36)}-${index}`,
        fileName: file.name,
        sizeBytes: file.size,
        status: "UPLOADED",
        progress: 0,
        error: null,
        documentId: null,
      }));

      setItems((current) => [...current, ...queued]);
      setBusy(true);

      // Sequential: the API takes one file per request, and serialising keeps
      // a 50-file drop from opening 50 sockets at once.
      for (const [index, file] of accepted.entries()) {
        const row = queued[index];
        try {
          const document = await uploadOne(file, candidateId, (percent) =>
            patch(row.id, { progress: Math.round(percent * 0.25) }),
          );
          byDocumentId.current.set(document.id, row.id);
          patch(row.id, {
            documentId: document.id,
            status: document.status,
            progress: 25,
          });
        } catch (error) {
          patch(row.id, {
            status: "FAILED",
            progress: 0,
            error: error instanceof Error ? error.message : "Upload failed.",
          });
        }
      }

      setBusy(false);
      onUploaded?.();
    },
    [candidateId, onUploaded, patch],
  );

  /** Applies a streamed pipeline event to whichever row owns that document. */
  const applyEvent = useCallback(
    (event: {
      documentId: string;
      documentStatus: DocumentStatus;
      progress: number;
      errorMessage?: string;
    }) => {
      const rowId = byDocumentId.current.get(event.documentId);
      if (!rowId) return;
      patch(rowId, {
        status: event.documentStatus,
        // Upload is the first quarter of the bar; the pipeline is the rest.
        progress: 25 + Math.round((event.progress / 100) * 75),
        error: event.errorMessage ?? null,
      });
    },
    [patch],
  );

  const remove = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setRejected([]);
    byDocumentId.current.clear();
  }, []);

  return { items, rejected, busy, addFiles, applyEvent, remove, clear };
}
