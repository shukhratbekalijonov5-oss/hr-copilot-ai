"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getPersonalResumeUrlAction,
  uploadPersonalResumeAction,
} from "@/app/(candidate)/actions";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AlertIcon, FileIcon, UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import { formatFileSize } from "@/lib/utils";
import type { PersonalResume } from "@/lib/types";

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
}: {
  resume: PersonalResume | null;
}) {
  const { d, f, date } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [opening, startOpen] = useTransition();

  function upload(file: File | undefined) {
    if (!file || pending) return;
    setError(null);

    if (file.size > MAX_RESUME_SIZE_BYTES) {
      setError(
        f(d.upload.tooLarge, {
          name: file.name,
          size: formatFileSize(MAX_RESUME_SIZE_BYTES),
        }),
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      const result = await uploadPersonalResumeAction(formData);
      if (!result.ok) {
        setError(
          result.message ?? d.candidateProfile.resumeUploadFailed,
        );
        return;
      }
      router.refresh();
    });
  }

  /** The signed URL is short-lived, so it is minted at the moment of opening. */
  function open() {
    if (opening) return;
    startOpen(async () => {
      const result = await getPersonalResumeUrlAction();
      if (result.ok && result.data) window.open(result.data.url, "_blank");
      else setError(d.candidates.documentOpenFailed);
    });
  }

  return (
    <Card>
      <CardHeader
        title={d.candidateProfile.resume}
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

        {resume ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-muted/40 px-3 py-2.5">
            <FileIcon className="size-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {resume.originalFileName}
              </span>
              <span className="block text-[12px] text-ink-subtle">
                {f(d.candidateProfile.uploadedOn, {
                  date: date(resume.createdAt),
                })}
                {resume.fileSize ? ` · ${formatFileSize(resume.fileSize)}` : ""}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={opening}
              onClick={open}
            >
              {d.candidateProfile.downloadResume}
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-ink-muted">
            {d.candidateProfile.noResume}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant={resume ? "secondary" : "primary"}
            size="sm"
            loading={pending}
            disabled={pending}
            icon={<UploadIcon className="size-4" />}
            onClick={() => inputRef.current?.click()}
          >
            {pending
              ? d.candidateProfile.uploading
              : resume
                ? d.candidateProfile.replaceResume
                : d.candidateProfile.uploadResume}
          </Button>
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
          {d.candidateProfile.personalResumeNote}
        </p>
      </CardBody>
    </Card>
  );
}
