"use client";

import { useState, useTransition } from "react";
import { getCurrentDocumentUrlAction } from "@/app/(app)/candidates/[id]/actions";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import {
  DocumentStatusBadge,
  LinkStatusBadge,
} from "@/components/ui/StatusBadge";
import { FileIcon, GlobeIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { displayUrl } from "@/lib/utils";
import type { CandidateCurrentEvidence } from "@/lib/types";

/**
 * The applicant's CURRENT profile and evidence — live account data the
 * backend resolves fresh on every read, behind the owned-vacancy +
 * legitimate-applicant chain. This is deliberately different from the
 * "Evidence sources" card next to it, which shows what was SUBMITTED with the
 * application.
 *
 * Identity (name, email, avatar) is NOT repeated here — the Profile card
 * above owns it, and reads the same live values. This card is the evidence
 * itself: the candidate's current files and professional links.
 *
 * Strictly read-only by design: no upload, edit, delete, or retry control
 * exists here or in the API behind it. Those belong to Candidate My Profile
 * alone. The only actions are reading a source in the left pane, opening a
 * document through a short-lived signed URL minted at click time, and opening
 * the original link.
 */
export function CurrentEvidenceCard({
  candidateId,
  vacancyId,
  evidence,
  onSelectDocument,
  onSelectLink,
}: {
  candidateId: string;
  vacancyId: string;
  evidence: CandidateCurrentEvidence;
  /** Shows this document in the left viewer. */
  onSelectDocument: (documentId: string) => void;
  /** Shows this link in the left pane. */
  onSelectLink: (linkId: string) => void;
}) {
  const { d, date } = useI18n();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /** Signed URLs are short-lived, so one is minted at the moment of opening. */
  function openDocument(documentId: string) {
    if (openingId) return;
    setError(null);
    setOpeningId(documentId);
    startTransition(async () => {
      const result = await getCurrentDocumentUrlAction(
        candidateId,
        vacancyId,
        documentId,
      );
      setOpeningId(null);
      if (result.ok) window.open(result.url, "_blank");
      else setError(result.message ?? d.candidates.documentOpenFailed);
    });
  }

  const documentTypeLabel = (sourceType: string): string =>
    d.status.documentType[
      sourceType as keyof typeof d.status.documentType
    ] ?? d.candidates.currentEvidenceDocument;

  return (
    <Card>
      <CardHeader
        title={d.candidates.currentEvidence}
        description={d.candidates.currentEvidenceHint}
      />

      {error ? (
        <p role="alert" className="px-4 pt-3 text-[12.5px] text-critical">
          {error}
        </p>
      ) : null}

      {evidence.documents.length + evidence.professionalLinks.length === 0 ? (
        <CardBody>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {d.candidates.currentEvidenceEmpty}
          </p>
        </CardBody>
      ) : (
        <div>
          {evidence.documents.length > 0 ? (
            <>
              <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {d.candidates.currentDocuments}
              </p>
              <ul className="divide-y divide-[var(--line)]">
                {evidence.documents.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <FileIcon className="size-4 shrink-0 text-ink-subtle" />
                    <button
                      type="button"
                      onClick={() => onSelectDocument(document.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13.5px] font-medium text-ink hover:text-brand">
                        {document.fileName}
                      </span>
                      <span className="block text-[12px] text-ink-muted">
                        {documentTypeLabel(document.sourceType)} ·{" "}
                        {date(document.uploadedAt)}
                      </span>
                    </button>
                    <DocumentStatusBadge status={document.status} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={openingId === document.id}
                      onClick={() => openDocument(document.id)}
                    >
                      {d.candidates.openCurrentFile}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {evidence.professionalLinks.length > 0 ? (
            <>
              <p className="border-t border-line px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                {d.candidates.currentLinks}
              </p>
              <ul className="divide-y divide-[var(--line)]">
                {evidence.professionalLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <GlobeIcon className="size-4 shrink-0 text-ink-subtle" />
                    <button
                      type="button"
                      onClick={() => onSelectLink(link.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13.5px] font-medium text-ink hover:text-brand">
                        {link.title ?? displayUrl(link.url, 40)}
                      </span>
                      <span className="block truncate text-[12px] text-ink-muted">
                        {displayUrl(link.url, 40)}
                        {link.analysedAt ? ` · ${date(link.analysedAt)}` : ""}
                      </span>
                    </button>
                    <LinkStatusBadge status={link.status} />
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-[12.5px] font-medium text-brand hover:underline"
                    >
                      {d.candidates.openOriginalLink}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}
