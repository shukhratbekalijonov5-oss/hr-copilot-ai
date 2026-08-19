"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ResumeUploader } from "@/components/upload/ResumeUploader";
import { UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

interface UploadPanelProps {
  /**
   * Documents attach to a candidate on the API — there is no vacancy-level
   * upload. Without a candidate the file is stored unlinked, so callers should
   * pass one wherever the context has it.
   */
  candidateId?: string | null;
  /** Overrides the default "Upload resumes" wording, already translated. */
  buttonLabel?: string;
}

/** Reveals the uploader in place so the page does not need a modal. */
export function UploadPanel({
  candidateId = null,
  buttonLabel,
}: UploadPanelProps) {
  const { d } = useI18n();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        icon={<UploadIcon className="size-4" />}
        onClick={() => setOpen(true)}
      >
        {buttonLabel ?? d.uploader.uploadResumes}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ResumeUploader candidateId={candidateId} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setOpen(false)}
      >
        {d.uploader.hideUploader}
      </Button>
    </div>
  );
}
