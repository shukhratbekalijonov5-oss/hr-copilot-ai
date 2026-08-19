"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setApplicationStatusAction } from "@/app/(app)/candidates/[id]/actions";
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
import { EvidenceCard } from "@/components/evidence/EvidenceCard";
import { ApplicationSourceBadge } from "@/components/candidates/ApplicationSourceBadge";
import {
  ActivityIcon,
  AlertIcon,
  MailIcon,
  MapPinIcon,
  SparkIcon,
} from "@/components/ui/icons";
import {
  APPLICATION_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/constants";
import { APPLICATION_STATUSES } from "@/lib/types";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";
import { formatDate, pluralize } from "@/lib/utils";
import type {
  ApplicationStatus,
  Candidate,
  Citation,
  RequirementEvidence,
  Vacancy,
} from "@/lib/types";

interface CandidateWorkspaceProps {
  candidate: Candidate;
  vacancy: Vacancy | null;
  evidence: RequirementEvidence[];
}

/** Shown where a feature depends on a backend route that does not exist yet. */
function NotAvailableYet({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <EmptyState
        icon={<SparkIcon className="size-5" />}
        title={title}
        description={description}
      />
    </Card>
  );
}

export function CandidateWorkspace({
  candidate,
  vacancy,
  evidence,
}: CandidateWorkspaceProps) {
  const router = useRouter();
  const [activeDocumentId, setActiveDocumentId] = useState(
    candidate.documents[0]?.id ?? null,
  );
  const [page, setPage] = useState(1);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const application = candidate.applications[0] ?? null;

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
      if (!result.ok) setStatusError(result.message ?? "Update failed.");
      else router.refresh();
    });
  }

  const analysisReady = candidate.processingStatus === "COMPLETED";
  const found = evidence.filter((item) => item.status === "FOUND").length;

  const overview = (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Candidate overview" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <div>
              <dt className="text-[12px] text-ink-muted">Current title</dt>
              <dd className="text-[13.5px] text-ink">
                {candidate.currentTitle ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">Experience</dt>
              <dd className="text-[13.5px] text-ink">
                {candidate.totalExperienceYears === null
                  ? "Not recorded"
                  : `${candidate.totalExperienceYears} ${pluralize(candidate.totalExperienceYears, "year")}`}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">Location</dt>
              <dd className="flex items-center gap-1.5 text-[13.5px] text-ink">
                <MapPinIcon className="size-3.5 text-ink-subtle" />
                {candidate.location ?? "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-muted">Email</dt>
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
                  "Not recorded"
                )}
              </dd>
            </div>
            {candidate.phone ? (
              <div>
                <dt className="text-[12px] text-ink-muted">Phone</dt>
                <dd className="text-[13.5px] text-ink">{candidate.phone}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[12px] text-ink-muted">Added</dt>
              <dd className="text-[13.5px] text-ink">
                {formatDate(candidate.createdAt)}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Documents"
          description={`${candidate.documents.length} ${pluralize(candidate.documents.length, "file")} uploaded`}
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
                    {DOCUMENT_TYPE_LABELS[document.type]} ·{" "}
                    {formatDate(document.createdAt)}
                  </span>
                </button>
                <DocumentStatusBadge status={document.status} />
              </li>
            ))}
          </ul>
        ) : null}

        <CardBody className={candidate.documents.length > 0 ? "border-t border-line" : undefined}>
          {candidate.documents.length === 0 ? (
            <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
              Upload a resume to have it parsed, indexed and checked against
              this vacancy&rsquo;s requirements.
            </p>
          ) : null}
          {/* Documents attach to this candidate, which is what links them to
              the vacancy's requirement checks. */}
          <ResumeUploader candidateId={candidate.id} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Applications"
          description="Stage changes are recorded against the person who made them."
        />
        {candidate.applications.length === 0 ? (
          <EmptyState
            title="Not attached to a vacancy"
            description="Attach this candidate to a vacancy to check their documents against its requirements."
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
                    {item.vacancy?.title ?? "Vacancy"}
                  </Link>
                  <span className="block text-[12px] text-ink-muted">
                    Applied {formatDate(item.createdAt)}
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

  const evidenceTab = !vacancy ? (
    <Card>
      <EmptyState
        title="No vacancy attached"
        description="Attach this candidate to a vacancy to check their documents against its requirements."
      />
    </Card>
  ) : candidate.documents.length === 0 ? (
    <Card>
      <EmptyState
        title="No documents to read"
        description="Requirement evidence comes from uploaded files. Upload a resume to begin."
      />
    </Card>
  ) : !analysisReady ? (
    <Card>
      <EmptyState
        icon={<ActivityIcon className="size-5" />}
        title={
          candidate.processingStatus === "FAILED"
            ? "Document processing failed"
            : "Analysis still running"
        }
        description={
          candidate.processingStatus === "FAILED"
            ? "This candidate's documents could not be processed, so there is no evidence to show. Check the processing queue for the reason."
            : "Requirement evidence appears once every document finishes indexing."
        }
      />
    </Card>
  ) : (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
        <span>
          <span className="font-semibold text-ink">{found}</span> of{" "}
          {evidence.length} requirements have supporting evidence
        </span>
        <span className="ml-auto">Checked against {vacancy.title}</span>
      </div>

      {evidence.length === 0 ? (
        <Card>
          <EmptyState
            title="This vacancy has no requirements yet"
            description="Add requirements to the vacancy and each one will be checked against the candidate's documents."
          />
        </Card>
      ) : (
        evidence.map((item) => (
          <EvidenceCard
            key={item.requirementId}
            evidence={item}
            onSelectCitation={openCitation}
            activeCitationId={activeCitation?.id ?? null}
          />
        ))
      )}
    </div>
  );

  const tabs: TabItem[] = [
    { id: "overview", label: "Overview", content: overview },
    {
      id: "evidence",
      label: "JD Evidence",
      badge:
        vacancy && analysisReady && evidence.length > 0 ? (
          <Badge tone="neutral">
            {found}/{evidence.length}
          </Badge>
        ) : null,
      content: evidenceTab,
    },
    {
      id: "summary",
      label: "AI Summary",
      content: BACKEND_CAPABILITIES.aiSummary ? null : (
        <NotAvailableYet
          title="Summaries are not available yet"
          description="A grounded summary is generated by the AI service once it indexes a candidate's documents. The API does not expose that route yet, so there is nothing to show — rather than a guess."
        />
      ),
    },
    {
      id: "questions",
      label: "Interview Questions",
      content: BACKEND_CAPABILITIES.interviewQuestions ? null : (
        <NotAvailableYet
          title="Interview questions are not available yet"
          description="Questions are drafted from requirement evidence by the AI service. That route is not exposed by the API yet."
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
              {candidate.currentTitle ?? "Title not recorded"}
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
                aria-label="Application stage"
                value={application.status}
                disabled={pending}
                options={APPLICATION_STATUSES.map((status) => ({
                  value: status,
                  label: APPLICATION_STATUS_LABELS[status],
                }))}
                onChange={(event) =>
                  changeStatus(event.target.value as ApplicationStatus)
                }
                className="w-44"
              />
              <span className="text-[11.5px] text-ink-subtle">
                Human decision required
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

        <Tabs items={tabs} className="min-w-0" />
      </div>
    </div>
  );
}
