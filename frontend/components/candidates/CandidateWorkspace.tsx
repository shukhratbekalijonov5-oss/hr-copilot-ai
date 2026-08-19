"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setApplicationStatusAction } from "@/app/(app)/candidates/[id]/actions";
import { AnswerPanel } from "@/components/ai/AnswerPanel";
import { EvidenceMapPanel } from "@/components/ai/EvidenceMapPanel";
import { InterviewQuestionsPanel } from "@/components/ai/InterviewQuestionsPanel";
import { SummaryPanel } from "@/components/ai/SummaryPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import {
  ApplicationStatusBadge,
  DocumentStatusBadge,
} from "@/components/ui/StatusBadge";
import { DocumentViewer } from "@/components/candidates/DocumentViewer";
import { ResumeUploader } from "@/components/upload/ResumeUploader";
import { ApplicationSourceBadge } from "@/components/candidates/ApplicationSourceBadge";
import { AlertIcon, MailIcon, MapPinIcon } from "@/components/ui/icons";
import { aiReadiness } from "@/lib/api/adapters";
import { useI18n } from "@/lib/i18n/context";
import { APPLICATION_STATUSES } from "@/lib/types";
import type {
  AiFailureReason,
  ApplicationStatus,
  Candidate,
  Citation,
  EvidenceMap,
  Role,
  Vacancy,
} from "@/lib/types";

interface CandidateWorkspaceProps {
  candidate: Candidate;
  /** The candidate's primary application's vacancy, or null. */
  vacancy: Vacancy | null;
  /** Stored requirement mapping, read server-side. Null when never run. */
  evidenceMap: EvidenceMap | null;
  evidenceMapFailure: AiFailureReason | null;
  role: Role;
}

/**
 * The candidate screen: the document on the left, everything read out of it on
 * the right.
 *
 * Citations from any panel — requirement mapping, summary, interview questions,
 * a grounded answer — drive the same viewer, so a claim is always one click
 * from the page it came from. The page number used is the backend's, never one
 * derived here.
 */
export function CandidateWorkspace({
  candidate,
  vacancy,
  evidenceMap,
  evidenceMapFailure,
  role,
}: CandidateWorkspaceProps) {
  const router = useRouter();
  const { d, f, p, date } = useI18n();

  const [activeDocumentId, setActiveDocumentId] = useState(
    candidate.documents[0]?.id ?? null,
  );
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const application = candidate.applications[0] ?? null;

  /**
   * Which vacancy the AI panels work against.
   *
   * Evidence mapping and interview questions are defined per (candidate,
   * vacancy), so a candidate applying to several roles needs to say which one.
   * Defaulting to the first application and hiding the rest would quietly show
   * one role's requirements while claiming to describe the candidate.
   */
  const vacancyOptions = candidate.applications
    .map((item) => item.vacancy)
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const [selectedVacancyId, setSelectedVacancyId] = useState(
    vacancy?.id ?? vacancyOptions[0]?.id ?? null,
  );

  const selectedVacancy =
    vacancyOptions.find((item) => item.id === selectedVacancyId) ??
    (vacancy ? { id: vacancy.id, title: vacancy.title, status: vacancy.status } : null);

  /**
   * Opens the passage behind a citation.
   *
   * `citation.page` comes from the backend response and is used as-is. A page
   * number computed on the client would look authoritative while pointing at
   * the wrong part of the file.
   */
  function openCitation(citation: Citation) {
    setActiveCitation(citation);
    setActiveDocumentId(citation.documentId);
    if (citation.page !== null) setPage(citation.page);
  }

  function changeStatus(status: ApplicationStatus) {
    if (!application) return;
    setStatusError(null);
    startTransition(async () => {
      const result = await setApplicationStatusAction(
        application.id,
        candidate.id,
        status,
      );
      if (!result.ok) setStatusError(result.message ?? d.candidates.updateFailed);
      else router.refresh();
    });
  }

  /**
   * The AI panels read whatever is indexed, so one document is enough. This is
   * intentionally more permissive than the headline status badge, which reports
   * the worst-case state across every file.
   */
  const readiness = aiReadiness(candidate.documents);
  const analysisReady = readiness === "ready";

  /**
   * Why the AI panels have nothing to read yet.
   *
   * Each case is distinct on purpose: no documents at all, documents still
   * moving through the pipeline, and a pipeline that failed outright are three
   * different situations, and a single "nothing here" would hide which applies.
   */
  const notReady: { title: string; description: string } | null =
    readiness === "ready"
      ? null
      : readiness === "no_documents"
        ? { title: d.ai.notProcessed, description: d.ai.notProcessedHint }
        : readiness === "failed"
          ? {
              title: d.ai.processingFailed,
              description: d.ai.processingFailedHint,
            }
          : {
              title: d.ai.stillProcessing,
              description: d.ai.stillProcessingHint,
            };

  const overview = (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title={d.candidates.overview} />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-ink-muted">
                {d.candidates.currentTitle}
              </dt>
              <dd className="text-[13.5px] text-ink">
                {candidate.currentTitle ?? d.common.notRecorded}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">
                {d.candidates.experience}
              </dt>
              <dd className="text-[13.5px] text-ink">
                {candidate.totalExperienceYears === null
                  ? d.common.notRecorded
                  : p(d.common.years, candidate.totalExperienceYears)}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">
                {d.candidates.location}
              </dt>
              <dd className="flex items-center gap-1.5 text-[13.5px] text-ink">
                <MapPinIcon className="size-3.5 text-ink-subtle" />
                {candidate.location ?? d.common.notRecorded}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">
                {d.candidates.email}
              </dt>
              <dd className="flex items-center gap-1.5 truncate text-[13.5px] text-ink">
                <MailIcon className="size-3.5 shrink-0 text-ink-subtle" />
                {candidate.email ? (
                  <a
                    href={`mailto:${candidate.email}`}
                    className="truncate hover:text-brand"
                  >
                    {candidate.email}
                  </a>
                ) : (
                  d.common.notRecorded
                )}
              </dd>
            </div>
            {candidate.phone ? (
              <div>
                <dt className="text-[12px] text-ink-muted">
                  {d.candidates.phone}
                </dt>
                <dd className="text-[13.5px] text-ink">{candidate.phone}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[12px] text-ink-muted">
                {d.candidates.added}
              </dt>
              <dd className="text-[13.5px] text-ink">
                {date(candidate.createdAt)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidates.documents}
          description={p(
            d.candidates.documentsUploaded,
            candidate.documents.length,
          )}
        />
        {candidate.documents.length > 0 ? (
          <ul className="divide-y divide-[var(--line)]">
            {candidate.documents.map((document) => (
              <li
                key={document.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveDocumentId(document.id);
                    setPage(1);
                    setActiveCitation(null);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[13.5px] font-medium text-ink hover:text-brand">
                    {document.originalFileName}
                  </span>
                  <span className="block text-[12px] text-ink-muted">
                    {d.status.documentType[document.type]} ·{" "}
                    {date(document.createdAt)}
                  </span>
                </button>
                <DocumentStatusBadge status={document.status} />
              </li>
            ))}
          </ul>
        ) : null}

        <CardBody
          className={
            candidate.documents.length > 0 ? "border-t border-line" : undefined
          }
        >
          {candidate.documents.length === 0 ? (
            <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
              {d.candidates.uploadPrompt}
            </p>
          ) : null}
          {/* Documents attach to this candidate, which is what links them to
              the vacancy's requirement checks. */}
          <ResumeUploader candidateId={candidate.id} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={d.candidates.applications}
          description={d.candidates.applicationsHint}
        />
        {candidate.applications.length === 0 ? (
          <EmptyState
            title={d.candidates.notAttached}
            description={d.candidates.notAttachedHint}
          />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {candidate.applications.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/vacancies/${item.vacancyId}`}
                    className="block truncate text-[13.5px] font-medium text-ink hover:text-brand"
                  >
                    {item.vacancy?.title ?? d.candidates.vacancy}
                  </Link>
                  <span className="block text-[12px] text-ink-muted">
                    {f(d.candidates.appliedOn, { date: date(item.createdAt) })}
                  </span>
                </div>
                <ApplicationSourceBadge source={item.source} />
                <ApplicationStatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  /** The server-rendered map only applies to the vacancy the page read. */
  const initialMapForSelection =
    evidenceMap && evidenceMap.vacancyId === selectedVacancyId
      ? evidenceMap
      : null;

  const vacancyPicker =
    vacancyOptions.length > 1 ? (
      <Select
        aria-label={d.candidates.filterVacancy}
        value={selectedVacancyId ?? ""}
        options={vacancyOptions.map((item) => ({
          value: item.id,
          label: item.title,
        }))}
        onChange={(event) => setSelectedVacancyId(event.target.value)}
        className="mb-3 sm:max-w-md"
      />
    ) : null;

  const evidenceTab = !selectedVacancy ? (
    <Card>
      <EmptyState
        title={d.evidence.noVacancy}
        description={d.evidence.noVacancyHint}
      />
    </Card>
  ) : candidate.documents.length === 0 ? (
    <Card>
      <EmptyState
        title={d.evidence.noDocuments}
        description={d.evidence.noDocumentsHint}
      />
    </Card>
  ) : (
    <>
      {vacancyPicker}
      <EvidenceMapPanel
        // Remounts on a vacancy change so the panel reloads for the new pair.
        key={selectedVacancy.id}
        candidateId={candidate.id}
        vacancyId={selectedVacancy.id}
        vacancyTitle={selectedVacancy.title}
        initialMap={initialMapForSelection}
        initialFailure={initialMapForSelection ? evidenceMapFailure : null}
        role={role}
        onSelectCitation={openCitation}
        activeCitationId={activeCitation?.id ?? null}
      />
    </>
  );

  const mappedFound =
    initialMapForSelection?.requirements.filter(
      (item) => item.status === "FOUND",
    ).length ?? 0;
  const mappedTotal = initialMapForSelection?.requirements.length ?? 0;

  const tabs: TabItem[] = [
    { id: "overview", label: d.candidates.tabOverview, content: overview },
    {
      id: "evidence",
      label: d.candidates.tabEvidence,
      badge:
        initialMapForSelection?.hasRun && mappedTotal > 0 ? (
          <Badge tone="neutral">
            {mappedFound}/{mappedTotal}
          </Badge>
        ) : null,
      content: evidenceTab,
    },
    {
      id: "summary",
      label: d.candidates.tabSummary,
      content: (
        <SummaryPanel
          candidateId={candidate.id}
          ready={analysisReady}
          notReady={notReady}
          onSelectCitation={openCitation}
          activeCitationId={activeCitation?.id ?? null}
        />
      ),
    },
    {
      id: "questions",
      label: d.candidates.tabQuestions,
      content: (
        <>
          {vacancyPicker}
          <InterviewQuestionsPanel
            candidateId={candidate.id}
            vacancyId={selectedVacancy?.id ?? null}
            ready={analysisReady}
            notReady={notReady}
            onSelectCitation={openCitation}
            activeCitationId={activeCitation?.id ?? null}
          />
        </>
      ),
    },
    {
      id: "ask",
      label: d.candidates.tabAsk,
      content: (
        <AnswerPanel
          candidateId={candidate.id}
          vacancyId={selectedVacancy?.id}
          ready={analysisReady}
          notReady={notReady}
          onSelectCitation={openCitation}
          activeCitationId={activeCitation?.id ?? null}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Avatar name={candidate.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              {candidate.fullName}
            </h1>
            <p className="text-[13.5px] text-ink-muted">
              {candidate.currentTitle ?? d.common.notSet}
              {candidate.location ? ` · ${candidate.location}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DocumentStatusBadge status={candidate.processingStatus} />
              {vacancy ? (
                <Link
                  href={`/vacancies/${vacancy.id}`}
                  className="text-[12.5px] text-ink-muted hover:text-brand"
                >
                  {vacancy.title}
                </Link>
              ) : null}
            </div>
          </div>

          {application ? (
            <div className="flex flex-col items-end gap-1.5">
              <Select
                aria-label={d.candidates.applicationStage}
                value={application.status}
                disabled={pending}
                options={APPLICATION_STATUSES.map((status) => ({
                  value: status,
                  label: d.status.application[status],
                }))}
                onChange={(event) =>
                  changeStatus(event.target.value as ApplicationStatus)
                }
                className="w-44"
              />
              <span className="text-[11.5px] text-ink-subtle">
                {d.common.humanDecision}
              </span>
            </div>
          ) : null}
        </div>

        {statusError ? (
          <p
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            <AlertIcon className="size-4 shrink-0" />
            {statusError}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <DocumentViewer
          documents={candidate.documents}
          activeDocumentId={activeDocumentId}
          page={page}
          activeCitation={activeCitation}
          onSelectDocument={(documentId) => {
            setActiveDocumentId(documentId);
            setPage(1);
            setActiveCitation(null);
          }}
          onChangePage={setPage}
          className="min-w-0 lg:sticky lg:top-18 lg:h-[calc(100dvh-7rem)]"
        />

        <Tabs
          items={tabs}
          label={d.candidates.title}
          className="min-w-0"
        />
      </div>
    </div>
  );
}
