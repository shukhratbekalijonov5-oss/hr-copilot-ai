"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  inviteToInterviewAction,
  setApplicationStatusAction,
} from "@/app/(app)/candidates/[id]/actions";
import { AnswerPanel } from "@/components/ai/AnswerPanel";
import { EvidenceMapPanel } from "@/components/ai/EvidenceMapPanel";
import { HrMatchSummaryCard } from "@/components/candidates/HrMatchSummaryCard";
import { HrMatchRequirementsCard } from "@/components/candidates/HrMatchRequirementsCard";
import type { HrMatchInsight } from "@/lib/match/hr-insight";
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
import { CurrentEvidenceCard } from "@/components/candidates/CurrentEvidenceCard";
import { CurrentLinkView } from "@/components/candidates/CurrentLinkView";
import { DocumentViewer } from "@/components/candidates/DocumentViewer";
import {
  AlertIcon,
  MapPinIcon,
  MessageIcon,
} from "@/components/ui/icons";
import { aiReadiness } from "@/lib/api/adapters";
import { openableOtherVacancies } from "@/lib/vacancy/applicants";
import { VACANCY_PARAM } from "@/lib/vacancy/selection";
import { useI18n } from "@/lib/i18n/context";
import { APPLICATION_STATUSES } from "@/lib/types";
import type {
  AiFailureReason,
  Application,
  ApplicationStatus,
  Candidate,
  CandidateCurrentEvidence,
  CandidateDocument,
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
  /** The CURRENT attempt in the ACTIVE vacancy — the stage shown in Overview. */
  activeApplication: Application | null;
  /**
   * Every attempt in the active vacancy, newest first, `attempts[0]` being
   * `activeApplication`. Resolved server-side by the same grouping the vacancy
   * applicant list uses.
   */
  attempts: Application[];
  applicationConversationId: string | null;
  /**
   * The applicant's LIVE profile/evidence for the ACTIVE vacancy context.
   * Null when no vacancy is selected or the read failed — the card simply
   * does not render then.
   */
  currentEvidence: CandidateCurrentEvidence | null;
  /** Stored requirement mapping, read server-side. Null when never run. */
  evidenceMap: EvidenceMap | null;
  evidenceMapFailure: AiFailureReason | null;
  /** The advanced assessment for the active pair, read on the server. */
  matchInsight: HrMatchInsight | null;
  matchInsightFailure: AiFailureReason | null;
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
  attempts,
  applicationConversationId,
  currentEvidence,
  evidenceMap,
  evidenceMapFailure,
  matchInsight,
  matchInsightFailure,
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
  /**
   * The applicant's CURRENT sources — the only evidence there is. Account
   * level and never per-attempt, so an id is stable across vacancy switches
   * and re-applications, and a deleted file is simply not in the list.
   */
  const currentDocuments = useMemo(
    () => currentEvidence?.documents ?? [],
    [currentEvidence],
  );
  const currentLinks = useMemo(
    () => currentEvidence?.professionalLinks ?? [],
    [currentEvidence],
  );
  /** The viewer's shape of the same current files. */
  const viewerDocuments = useMemo<CandidateDocument[]>(
    () =>
      currentDocuments.map((document) => ({
        id: document.id,
        type: document.sourceType,
        originalFileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        status: document.status,
        pageCount: document.pageCount,
        uploadedAt: document.uploadedAt,
      })),
    [currentDocuments],
  );

  const [activeSource, setActiveSource] = useState<ActiveSource>(() =>
    currentDocuments[0]
      ? { type: "FILE", id: currentDocuments[0].id }
      : currentLinks[0]
        ? { type: "URL", id: currentLinks[0].id }
        : { type: "FILE", id: null },
  );
  // Resolve the selection against what exists RIGHT NOW: a stale id (a file
  // deleted since selection, a citation into a withdrawn source) falls back
  // to the first current file instead of resurrecting anything.
  const activeDocumentId =
    activeSource.type === "FILE"
      ? activeSource.id &&
        viewerDocuments.some((document) => document.id === activeSource.id)
        ? activeSource.id
        : (viewerDocuments[0]?.id ?? null)
      : null;
  const activeLink =
    activeSource.type === "URL"
      ? (currentLinks.find((link) => link.id === activeSource.id) ?? null)
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
  const readiness = aiReadiness([...currentDocuments, ...currentLinks]);
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

  /**
   * The applicant's identity, preferring the LIVE account over the
   * application-time copy.
   *
   * A candidate who corrects their name or changes their email after applying
   * should be reachable under the value that is true now — the frozen copy is
   * evidence about the application, not a current address. Falls back to the
   * org-side record when there is no vacancy context to read live data under.
   */
  /**
   * Every OTHER vacancy this person is in THAT THIS RECRUITER MAY OPEN.
   *
   * `candidate.applications` is organization-scoped: it carries every vacancy
   * the person applied to anywhere in the org, including a colleague's. HR
   * vacancy workflows are creator-scoped, so those are rows the backend will
   * refuse — offering them as links is offering a dead end.
   *
   * The filter is therefore an INTERSECTION with `eligibleVacancies`, which
   * the server already resolved as "this candidate's applications AND the
   * caller's own vacancies". Nothing is authorized here; this list is a
   * projection of a set the backend already agreed to. Matching is on vacancy
   * id — several vacancies legitimately share a title, so a title match would
   * both hide and expose the wrong ones.
   *
   * The list is attempt-level, so a re-applicant's vacancy appears once per
   * attempt; grouping by vacancy — with the same recency rule the active
   * block uses — collapses that to one row per pipeline. The active vacancy is
   * excluded: it already has the section above.
   */
  const otherVacancies = useMemo(
    () =>
      openableOtherVacancies(
        candidate.applications,
        eligibleVacancies.map((vacancy) => vacancy.id),
        selectedVacancyId,
      ),
    [candidate.applications, eligibleVacancies, selectedVacancyId],
  );

  const identity = {
    fullName: currentEvidence?.candidate.fullName ?? candidate.fullName,
    email: currentEvidence?.candidate.email ?? candidate.email,
    avatarUrl: currentEvidence?.candidate.avatarUrl ?? null,
  };

  const overview = (
    <div className="flex flex-col gap-4">
      {/*
        The recruiter's headline read, first thing on the page. Keyed on the
        active vacancy so a switch discards it rather than relabelling it.
      */}
      {selectedVacancy ? (
        <HrMatchSummaryCard
          key={`summary-${selectedVacancy.id}`}
          insight={matchInsight}
          failure={matchInsightFailure}
          vacancyTitle={selectedVacancy.title}
        />
      ) : null}

      {/* PROFILE — who this person is, right now. */}
      <Card>
        <CardHeader title={d.candidates.profile} />
        <CardBody className="flex items-center gap-3 border-b border-line">
          <Avatar name={identity.fullName} src={identity.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-medium text-ink">
              {identity.fullName}
            </p>
            {identity.email ? (
              <a
                href={`mailto:${identity.email}`}
                className="block truncate text-[12.5px] text-ink-muted hover:text-brand"
              >
                {identity.email}
              </a>
            ) : (
              <p className="text-[12.5px] text-ink-muted">
                {d.common.notRecorded}
              </p>
            )}
          </div>
        </CardBody>
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
        The applicant's CURRENT evidence — live account data resolved fresh by
        the backend for the active owned vacancy. Renders only with a vacancy
        context, because the authorization chain requires one.
      */}
      {currentEvidence && selectedVacancy ? (
        <CurrentEvidenceCard
          candidateId={candidate.id}
          vacancyId={selectedVacancy.id}
          evidence={currentEvidence}
          onSelectDocument={(documentId) =>
            selectSource({ type: "FILE", id: documentId })
          }
          onSelectLink={(linkId) => selectSource({ type: "URL", id: linkId })}
        />
      ) : null}

      {/*
        APPLICATION — historical by nature, and kept visually apart from the
        live evidence above so the two are never read as one thing. The stage
        and the date are the CURRENT attempt's; the earlier attempts are
        history, unchanged and undeleted.
      */}
      <Card>
        <CardHeader
          title={d.candidates.application}
          description={d.candidates.applicationsHint}
        />
        {!primaryApplication ? (
          <EmptyState
            title={
              selectedVacancy
                ? d.candidates.noApplicationForVacancy
                : d.candidates.notAttached
            }
            description={d.candidates.notAttachedHint}
          />
        ) : (
          <CardBody className="flex flex-col gap-3">
            <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-ink-muted">
                  {d.candidates.appliedAt}
                </dt>
                <dd className="text-[13.5px] text-ink">
                  {date(primaryApplication.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-muted">
                  {d.candidates.currentStatus}
                </dt>
                <dd>
                  <ApplicationStatusBadge status={primaryApplication.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-muted">
                  {d.candidates.attempts}
                </dt>
                <dd className="text-[13.5px] tabular-nums text-ink">
                  {Math.max(attempts.length, 1)}
                </dd>
              </div>
            </dl>

            {/*
              Earlier attempts. A plain <details> — no client state to keep in
              sync, and it collapses away entirely for the common single-attempt
              case.
            */}
            {attempts.length > 1 ? (
              <details className="group border-t border-line pt-3">
                <summary className="w-fit cursor-pointer list-none text-[12.5px] font-medium text-brand hover:underline">
                  <span className="group-open:hidden">
                    {d.attempts.viewHistory}
                  </span>
                  <span className="hidden group-open:inline">
                    {d.attempts.hideHistory}
                  </span>
                </summary>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {d.attempts.history}
                </p>
                <ol className="mt-1.5 flex flex-col gap-1.5">
                  {attempts.map((attempt, index) => (
                    <li
                      key={attempt.id}
                      className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted"
                    >
                      <span className="text-ink">
                        {f(d.attempts.label, {
                          number: attempts.length - index,
                        })}
                      </span>
                      {/*
                        The current attempt's stage can have just been changed
                        in this session; the props behind `attempts` only catch
                        up on the refresh. Reading it from the live value keeps
                        the history row and the summary above from disagreeing
                        for a beat.
                      */}
                      <ApplicationStatusBadge
                        status={
                          attempt.id === primaryApplication.id
                            ? primaryApplication.status
                            : attempt.status
                        }
                      />
                      <span>
                        {f(d.candidates.appliedOn, {
                          date: date(attempt.createdAt),
                        })}
                      </span>
                      {attempt.id === primaryApplication.id ? (
                        <Badge>{d.attempts.current}</Badge>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </CardBody>
        )}
      </Card>

      {/*
        The OTHER pipelines this person is in — one row per vacancy, not per
        attempt, so a re-applicant's vacancy is listed once with its count.
      */}
      {otherVacancies.length > 0 ? (
        <Card>
          <CardHeader
            title={d.candidates.otherVacancies}
            description={d.candidates.otherVacanciesHint}
          />
          <ul className="divide-y divide-[var(--line)]">
            {otherVacancies.map((row) => (
              <li
                key={row.vacancyId}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  {/*
                    Switches this candidate into that vacancy's context rather
                    than leaving the person — the whole page is "this
                    candidate, in this vacancy", and the target is a vacancy
                    the caller owns.
                  */}
                  <Link
                    href={`/candidates/${candidate.id}?${VACANCY_PARAM}=${row.vacancyId}`}
                    className="block truncate text-[13.5px] font-medium text-ink hover:text-brand"
                  >
                    {row.vacancy?.title ?? d.candidates.vacancy}
                  </Link>
                  <span className="block text-[12px] text-ink-muted">
                    {f(d.candidates.appliedOn, {
                      date: date(row.current.createdAt),
                    })}
                    {row.attemptCount > 1
                      ? ` · ${p(d.attempts.count, row.attemptCount)}`
                      : ""}
                  </span>
                </div>
                <ApplicationStatusBadge status={row.current.status} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
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
  ) : currentDocuments.length + currentLinks.length === 0 ? (
    <Card>
      <EmptyState
        title={d.evidence.noDocuments}
        description={d.evidence.noDocumentsHint}
      />
    </Card>
  ) : (
    <>
      {/*
        Advanced assessment for THIS pair. Keyed on the vacancy for the same
        reason as the map below: a vacancy switch must discard it, never
        re-label it.
      */}
      {/*
        The PROOF half of the assessment. The headline numbers live in
        Overview; this tab carries the per-requirement verdicts and their
        citations, above the retrieval view of the same documents.
      */}
      <HrMatchRequirementsCard
        key={`requirements-${selectedVacancy.id}`}
        insight={matchInsight}
        vacancyTitle={selectedVacancy.title}
      />
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
          <Avatar
            name={identity.fullName}
            src={identity.avatarUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              {identity.fullName}
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
          <CurrentLinkView
            link={activeLink}
            activeCitation={activeCitation}
            className="min-w-0 lg:sticky lg:top-18 lg:h-[calc(100dvh-7rem)]"
          />
        ) : (
          <DocumentViewer
            documents={viewerDocuments}
            candidateId={candidate.id}
            vacancyId={selectedVacancyId ?? ""}
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
