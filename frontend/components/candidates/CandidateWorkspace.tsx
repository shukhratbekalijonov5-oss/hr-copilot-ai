"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  inviteToInterviewAction,
  setApplicationStatusAction,
} from "@/app/(app)/candidates/[id]/actions";
import { AnswerPanel } from "@/components/ai/AnswerPanel";
import { EvidenceMapPanel } from "@/components/ai/EvidenceMapPanel";
import { InterviewQuestionsPanel } from "@/components/ai/InterviewQuestionsPanel";
import { SummaryPanel } from "@/components/ai/SummaryPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Field";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import {
  ApplicationStatusBadge,
  DocumentStatusBadge,
} from "@/components/ui/StatusBadge";
import { MyVacancySelector } from "@/components/vacancies/MyVacancySelector";
import { DocumentViewer } from "@/components/candidates/DocumentViewer";
import { LinkSourceView } from "@/components/candidates/LinkSourceView";
import {
  AlertIcon,
  FileIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  MessageIcon,
} from "@/components/ui/icons";
import { aiReadiness } from "@/lib/api/adapters";
import { useI18n } from "@/lib/i18n/context";
import { displayUrl } from "@/lib/utils";
import { APPLICATION_STATUSES } from "@/lib/types";
import type {
  AiFailureReason,
  Application,
  ApplicationStatus,
  Candidate,
  Citation,
  EvidenceMap,
  MyVacancy,
  Role,
} from "@/lib/types";

interface CandidateWorkspaceProps {
  candidate: Candidate;
  /**
   * Vacancies this candidate is in AND the caller created. Resolved on the
   * server from real associations — never invented client-side.
   */
  eligibleVacancies: MyVacancy[];
  /** The active vacancy, resolved from `?vacancyId=`. */
  activeVacancy: MyVacancy | null;
  /** True when the URL asked for a vacancy that is not selectable. */
  invalidSelection: boolean;
  /** The application in the ACTIVE vacancy — the stage shown in Overview. */
  activeApplication: Application | null;
  applicationConversationId: string | null;
  /** Stored requirement mapping, read server-side. Null when never run. */
  evidenceMap: EvidenceMap | null;
  evidenceMapFailure: AiFailureReason | null;
  role: Role;
}

/**
 * Which evidence source the left pane is showing. One selection across both
 * kinds — a citation can point at either, and the pane shows one thing.
 */
interface ActiveSource {
  type: "FILE" | "URL";
  id: string | null;
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
  eligibleVacancies,
  activeVacancy,
  invalidSelection,
  activeApplication,
  applicationConversationId,
  evidenceMap,
  evidenceMapFailure,
  role,
}: CandidateWorkspaceProps) {
  const router = useRouter();
  const { d, f, p, date } = useI18n();

  /**
   * Which evidence source the left pane is showing.
   *
   * One selection across BOTH kinds, because a citation can point at either and
   * the pane can only show one thing. Files default to being selected first
   * (they are the primary submission), falling back to a link when a candidate
   * somehow has only links.
   */
  const [activeSource, setActiveSource] = useState<ActiveSource>(() =>
    candidate.documents[0]
      ? { type: "FILE", id: candidate.documents[0].id }
      : candidate.linkSources[0]
        ? { type: "URL", id: candidate.linkSources[0].id }
        : { type: "FILE", id: null },
  );
  const activeDocumentId =
    activeSource.type === "FILE" ? activeSource.id : null;
  const activeLinkSource =
    activeSource.type === "URL"
      ? (candidate.linkSources.find((source) => source.id === activeSource.id) ??
        null)
      : null;
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The stage is per-vacancy: the same person sits in several pipelines with
  // independent stages, so this follows the selection rather than being a
  // candidate-global property.
  const application = activeApplication;
  const [primaryApplication, setPrimaryApplication] = useState(application);
  const [conversationId, setConversationId] = useState(applicationConversationId);

  /**
   * Which vacancy everything vacancy-dependent works against.
   *
   * There is exactly ONE source of truth for it — the `?vacancyId=` search
   * param resolved on the server — so Overview, Evidence, Summary, Questions
   * and Ask can never disagree about which vacancy is active. Switching it is
   * a navigation, which re-runs the server component and remounts the
   * dependent panels, so nothing from the previous vacancy survives.
   */
  const selectedVacancy = activeVacancy;
  const selectedVacancyId = activeVacancy?.id ?? null;

  /**
   * Opens the passage behind a citation.
   *
   * `citation.page` comes from the backend response and is used as-is. A page
   * number computed on the client would look authoritative while pointing at
   * the wrong part of the file.
   */
  function openCitation(citation: Citation) {
    setActiveCitation(citation);
    // The citation says which KIND of source it came from, so the pane can
    // switch between the file viewer and the link view without guessing.
    setActiveSource({
      type: citation.sourceType,
      id: citation.documentId,
    });
    if (citation.page !== null) setPage(citation.page);
  }

  function selectSource(next: ActiveSource) {
    setActiveSource(next);
    setPage(1);
    setActiveCitation(null);
  }

  function changeStatus(status: ApplicationStatus) {
    if (!primaryApplication) return;
    setStatusError(null);
    startTransition(async () => {
      if (status === "INTERVIEW") {
        const result = await inviteToInterviewAction(
          primaryApplication.id,
          candidate.id,
        );
        if (!result.ok) {
          setStatusError(result.message ?? d.candidates.updateFailed);
          return;
        }
        setPrimaryApplication(result.data.application);
        // An applicant always owns the account they applied with, so the
        // invitation always comes back with its conversation.
        setConversationId(result.data.conversation.id);
        router.refresh();
        return;
      }

      const result = await setApplicationStatusAction(
        primaryApplication.id,
        candidate.id,
        status,
      );
      if (!result.ok) {
        setStatusError(result.message ?? d.candidates.updateFailed);
        return;
      }
      if (status === "REJECTED") {
        setConversationId(null);
      }
      setPrimaryApplication({ ...primaryApplication, status });
      router.refresh();
    });
  }

  function invite() {
    changeStatus("INTERVIEW");
  }

  function reject() {
    changeStatus("REJECTED");
  }

  /**
   * The AI panels read whatever is indexed, so one document is enough. This is
   * intentionally more permissive than the headline status badge, which reports
   * the worst-case state across every file.
   */
  const readiness = aiReadiness(candidate.documents, candidate.linkSources);
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

      {/*
        Every source the candidate submitted, of both kinds, in one list.
        There are no add/edit/remove controls anywhere in here and no API
        behind one: files and links alike are the applicant's own submissions.
      */}
      <Card>
        <CardHeader
          title={d.candidates.evidenceSources}
          description={f(d.candidates.evidenceSourceCounts, {
            files: candidate.documents.length,
            links: candidate.linkSources.length,
          })}
        />
        {candidate.documents.length + candidate.linkSources.length > 0 ? (
          <div>
            {candidate.documents.length > 0 ? (
              <>
                <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {p(d.candidates.filesCount, candidate.documents.length)}
                </p>
                <ul className="divide-y divide-[var(--line)]">
                  {candidate.documents.map((document) => (
                    <li
                      key={document.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <FileIcon className="size-4 shrink-0 text-ink-subtle" />
                      <button
                        type="button"
                        onClick={() =>
                          selectSource({ type: "FILE", id: document.id })
                        }
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
              </>
            ) : null}

            {candidate.linkSources.length > 0 ? (
              <>
                <p className="border-t border-line px-4 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {p(d.candidates.linksCount, candidate.linkSources.length)}
                </p>
                <ul className="divide-y divide-[var(--line)]">
                  {candidate.linkSources.map((source) => (
                    <li
                      key={source.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <GlobeIcon className="size-4 shrink-0 text-ink-subtle" />
                      <button
                        type="button"
                        onClick={() =>
                          selectSource({ type: "URL", id: source.id })
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[13.5px] font-medium text-ink hover:text-brand">
                          {source.title}
                        </span>
                        <span className="block truncate text-[12px] text-ink-muted">
                          {displayUrl(source.url, 40)} · {date(source.fetchedAt)}
                        </span>
                      </button>
                      <DocumentStatusBadge status={source.status} />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : (
          <CardBody>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              {d.candidates.noDocumentsYet}
            </p>
          </CardBody>
        )}
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

  const evidenceTab = !selectedVacancy ? (
    <Card>
      <EmptyState
        title={d.evidence.noVacancy}
        description={d.evidence.noVacancyHint}
      />
    </Card>
  ) : candidate.documents.length + candidate.linkSources.length === 0 ? (
    <Card>
      <EmptyState
        title={d.evidence.noDocuments}
        description={d.evidence.noDocumentsHint}
      />
    </Card>
  ) : (
    <>
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
          key={selectedVacancy?.id ?? "none"}
          candidateId={candidate.id}
          vacancyId={selectedVacancy?.id ?? ""}
          vacancyTitle={selectedVacancy?.title}
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
              <InterviewQuestionsPanel
            key={selectedVacancy?.id ?? "none"}
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
          key={selectedVacancy?.id ?? "none"}
          candidateId={candidate.id}
          vacancyId={selectedVacancy?.id ?? ""}
          vacancyTitle={selectedVacancy?.title}
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
      {/* The active vacancy is the page's context, so it sits at the top in
          plain sight rather than inside a tab or a menu. */}
      <MyVacancySelector
        vacancies={eligibleVacancies}
        value={selectedVacancyId}
        invalid={invalidSelection}
        label={d.vacancyScope.selectorLabel}
      />

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
              {selectedVacancy ? (
                <Link
                  href={`/vacancies/${selectedVacancy.id}`}
                  className="text-[12.5px] text-ink-muted hover:text-brand"
                >
                  {selectedVacancy.title}
                </Link>
              ) : null}
            </div>
          </div>

          {primaryApplication ? (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                {conversationId ? (
                  <Link
                    href={`/interview-chats?conversation=${conversationId}`}
                    className="inline-flex h-9.5 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                  >
                    <MessageIcon className="size-4" />
                    {d.chat.openChat}
                  </Link>
                ) : null}
                {primaryApplication.status !== "INTERVIEW" ? (
                  <Button
                    type="button"
                    variant="primary"
                    loading={pending}
                    onClick={invite}
                  >
                    {d.chat.inviteToInterview}
                  </Button>
                ) : null}
                {primaryApplication.status !== "REJECTED" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={reject}
                  >
                    {d.chat.reject}
                  </Button>
                ) : null}
              </div>
              <Select
                aria-label={d.candidates.applicationStage}
                value={primaryApplication.status}
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
        {/*
          A URL source is NOT rendered through the PDF viewer: it has no pages
          and no file, and pretending otherwise would show an empty frame. Each
          kind gets the view that tells the truth about it.
        */}
        {activeSource.type === "URL" ? (
          <LinkSourceView
            source={activeLinkSource}
            activeCitation={activeCitation}
            className="min-w-0 lg:sticky lg:top-18 lg:h-[calc(100dvh-7rem)]"
          />
        ) : (
          <DocumentViewer
            documents={candidate.documents}
            activeDocumentId={activeDocumentId}
            page={page}
            activeCitation={activeCitation}
            onSelectDocument={(documentId) =>
              selectSource({ type: "FILE", id: documentId })
            }
            onChangePage={setPage}
            className="min-w-0 lg:sticky lg:top-18 lg:h-[calc(100dvh-7rem)]"
          />
        )}

        <Tabs
          items={tabs}
          label={d.candidates.title}
          className="min-w-0"
        />
      </div>
    </div>
  );
}
