"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deletePersonalDocumentAction,
  getPersonalDocumentUrlAction,
  getPersonalResumeUrlAction,
  reprocessPersonalDocumentAction,
} from "@/app/(candidate)/actions";
import { uploadPersonalDocument } from "@/lib/candidate/upload-document";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AlertIcon, FileIcon, UploadIcon } from "@/components/ui/icons";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { useI18n } from "@/lib/i18n/context";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import { localizedDocumentError } from "@/lib/documents/errors";
import { formatFileSize } from "@/lib/utils";
import type {
  PersonalDocument,
  PersonalDocumentCollection,
  PersonalResume,
} from "@/lib/types";

/**
 * The personal resume.
 *
 * Deliberately explicit about where this file lives: it belongs to the account,
 * sits in a private storage namespace with no organization, and is never
 * indexed for recruiter search. Only applying creates an organization-scoped
 * copy — so the UI must not imply that uploading here exposes anything to
 * anyone.
 */
export function PersonalResumeCard({
  resume,
  collection,
}: {
  resume: PersonalResume | null;
  collection: PersonalDocumentCollection;
}) {
  const { d, f, date } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  // Uploading is its own state rather than a transition: the bytes go straight
  // to a route handler over `fetch`, not through a Server Action, so there is
  // no action for a transition to track.
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [opening, startOpen] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  // Deleting a file also withdraws it from applications already submitted, so
  // it is confirmed rather than done on a single click.
  const [confirming, setConfirming] = useState<PersonalDocument | null>(null);

  const documents = collection.documents;
  const primaryDocumentId = collection.primaryDocumentId ?? resume?.id ?? null;
  const atLimit = collection.remaining <= 0;

  function upload(file: File | undefined) {
    if (!file || pending || uploading) return;
    setError(null);

    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!(ACCEPTED_RESUME_EXTENSIONS as readonly string[]).includes(extension)) {
      setError(
        f(d.upload.unsupportedType, {
          name: file.name,
        }),
      );
      return;
    }

    if (file.size > MAX_RESUME_SIZE_BYTES) {
      setError(
        f(d.upload.tooLarge, {
          name: file.name,
          size: formatFileSize(MAX_RESUME_SIZE_BYTES),
        }),
      );
      return;
    }

    setUploading(true);
    void (async () => {
      // Posted as multipart to a route handler, NOT serialised into a Server
      // Action payload — that is what the 1 MB action body limit applied to.
      const result = await uploadPersonalDocument(file);
      setUploading(false);

      if (!result.ok) {
        setError(
          localizedDocumentError(
            result.code,
            d,
            result.message ?? d.candidateProfile.resumeUploadFailed,
          ),
        );
        return;
      }
      // The page reads its documents with `no-store`, so re-rendering the route
      // is enough to show the new file.
      startTransition(() => router.refresh());
    })();
  }

  /** Signed URLs are short-lived, so one is minted at the moment of opening. */
  function open(documentId: string | null) {
    if (opening) return;
    startOpen(async () => {
      const result = documentId
        ? await getPersonalDocumentUrlAction(documentId)
        : await getPersonalResumeUrlAction();
      if (result.ok && result.data) window.open(result.data.url, "_blank");
      else setError(d.candidates.documentOpenFailed);
    });
  }

  function remove(documentId: string) {
    if (deletingId || pending || uploading) return;
    setError(null);
    setDeletingId(documentId);
    startTransition(async () => {
      const result = await deletePersonalDocumentAction(documentId);
      setDeletingId(null);
      if (!result.ok) {
        setError(
          localizedDocumentError(
            result.code,
            d,
            result.message ?? d.candidateProfile.documentDeleteFailed,
          ),
        );
        return;
      }
      setConfirming(null);
      // The list is re-read from the backend; nothing is kept locally that
      // could disagree with what was actually saved.
      router.refresh();
    });
  }

  /**
   * Requeues a FAILED document. The bytes are already stored, so no re-upload:
   * the retry indexes exactly the file the candidate stands behind.
   */
  function retry(documentId: string) {
    if (retryingId || pending || uploading) return;
    setError(null);
    setRetryingId(documentId);
    startTransition(async () => {
      const result = await reprocessPersonalDocumentAction(documentId);
      setRetryingId(null);
      if (!result.ok) {
        setError(
          localizedDocumentError(
            result.code,
            d,
            result.message ?? d.candidateProfile.documentRetryFailed,
          ),
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title={d.candidateProfile.documents}
        description={f(d.candidateProfile.resumeHint, {
          size: formatFileSize(MAX_RESUME_SIZE_BYTES),
        })}
      />
      <CardBody className="flex flex-col gap-3">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            <AlertIcon className="mt-px size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {documents.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-muted/40 px-3 py-2.5"
              >
                <FileIcon className="size-4 shrink-0 text-ink-subtle" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-ink">
                      {document.originalFileName}
                    </span>
                    {document.id === primaryDocumentId ? (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-ink">
                        {d.candidateProfile.primaryResume}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-[12px] text-ink-subtle">
                    {f(d.candidateProfile.uploadedOn, {
                      date: date(document.createdAt),
                    })}
                    {document.fileSize
                      ? ` · ${formatFileSize(document.fileSize)}`
                      : ""}
                  </span>
                </span>
                <DocumentStatusBadge status={document.status} />
                {document.status === "FAILED" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={retryingId === document.id}
                    disabled={pending}
                    onClick={() => retry(document.id)}
                  >
                    {d.candidateProfile.retryDocument}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={opening}
                  onClick={() => open(document.id)}
                >
                  {d.candidateProfile.downloadResume}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={deletingId === document.id}
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setConfirming(document);
                  }}
                >
                  {d.candidateProfile.deleteDocument}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-muted">
            {d.candidateProfile.noResume}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant={documents.length > 0 ? "secondary" : "primary"}
            size="sm"
            loading={uploading}
            disabled={pending || uploading || atLimit}
            icon={<UploadIcon className="size-4" />}
            onClick={() => inputRef.current?.click()}
          >
            {uploading
              ? d.candidateProfile.uploading
              : documents.length > 0
                ? d.candidateProfile.addDocument
                : d.candidateProfile.uploadResume}
          </Button>
          <span className="text-[12.5px] text-ink-muted">
            {f(d.candidateProfile.documentSlots, {
              count: documents.length,
              limit: collection.limit,
            })}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_RESUME_EXTENSIONS.join(",")}
            className="sr-only"
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <p className="text-[12px] leading-relaxed text-ink-subtle">
          {atLimit
            ? d.candidateProfile.documentLimitReached
            : d.candidateProfile.personalResumeNote}
        </p>

        <ConfirmDialog
          open={confirming !== null}
          title={d.candidateProfile.confirmDeleteTitle}
          question={f(d.candidateProfile.confirmDeleteQuestion, {
            name: confirming?.originalFileName ?? "",
          })}
          consequence={d.candidateProfile.confirmDeleteConsequence}
          confirmLabel={d.candidateProfile.deleteDocument}
          error={error}
          pending={pending}
          onConfirm={() => confirming && remove(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      </CardBody>
    </Card>
  );
}
