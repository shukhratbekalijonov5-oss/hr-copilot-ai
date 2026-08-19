import Link from "next/link";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonStyles } from "@/components/ui/Button";
import {
  DocumentStatusBadge,
  ProcessingJobStatusBadge,
  VacancyStatusBadge,
} from "@/components/ui/StatusBadge";
import { ProcessingProgress } from "@/components/processing/ProcessingProgress";
import {
  ActivityIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  PlusIcon,
  SparkIcon,
  UploadIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { formatRelativeTime, pluralize } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const QUICK_ACTIONS = [
  {
    href: "/vacancies/new",
    label: "Create vacancy",
    description: "Define requirements the copilot will look for.",
    icon: PlusIcon,
  },
  {
    href: "/candidates/new",
    label: "Add candidate",
    description: "Create a person, then upload their resume.",
    icon: UsersIcon,
  },
  {
    href: "/processing",
    label: "Upload resumes",
    description: "Drop PDFs or DOCX and watch them index.",
    icon: UploadIcon,
  },
];

export default async function DashboardPage() {
  await requireSession();

  const {
    generatedAt,
    stats,
    recentVacancies,
    recentCandidates,
    processing,
    recentJobs,
  } = await api.getDashboard();

  const referenceTime = new Date(generatedAt).getTime();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Dashboard"
        description="Where your pipeline stands right now."
        actions={
          <Link href="/vacancies/new" className={buttonStyles("primary", "md")}>
            <PlusIcon className="size-4" />
            New vacancy
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total candidates"
          value={stats.totalCandidates}
          href="/candidates"
          icon={<UsersIcon className="size-4" />}
          hint="Across every vacancy in this workspace"
        />
        <StatCard
          label="Active vacancies"
          value={stats.activeVacancies}
          href="/vacancies"
          icon={<BriefcaseIcon className="size-4" />}
          hint="Open and accepting candidates"
        />
        <StatCard
          label="Resumes processing"
          value={stats.resumesProcessing}
          href="/processing"
          icon={<ActivityIcon className="size-4" />}
          hint="In the parse → index pipeline"
        />
        <StatCard
          label="Completed analyses"
          value={stats.completedAnalyses}
          icon={<SparkIcon className="size-4" />}
          hint="Documents indexed and ready to read"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-line-strong hover:bg-surface-muted/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
                <Icon className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">
                  {action.label}
                </span>
                <span className="block truncate text-[12.5px] text-ink-muted">
                  {action.description}
                </span>
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent vacancies"
            action={
              <Link
                href="/vacancies"
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                View all
              </Link>
            }
          />
          {recentVacancies.length === 0 ? (
            <EmptyState
              icon={<BriefcaseIcon className="size-5" />}
              title="No vacancies yet"
              description="Create your first vacancy to tell the copilot what to look for."
              action={
                <Link
                  href="/vacancies/new"
                  className={buttonStyles("primary", "sm")}
                >
                  Create vacancy
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentVacancies.map((vacancy) => (
                <li key={vacancy.id}>
                  <Link
                    href={`/vacancies/${vacancy.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink">
                        {vacancy.title}
                      </p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {vacancy.department ?? "No department"} ·{" "}
                        {vacancy.location ?? "No location"}
                      </p>
                    </div>
                    <span className="hidden text-[12.5px] text-ink-muted sm:block">
                      {vacancy.candidateCount}{" "}
                      {pluralize(vacancy.candidateCount, "candidate")}
                    </span>
                    <VacancyStatusBadge status={vacancy.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Processing activity"
            description="Documents that reached each stage"
          />
          <CardBody>
            <ProcessingProgress summary={processing} />
            <Link
              href="/processing"
              className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            >
              Open processing queue
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent candidates"
            action={
              <Link
                href="/candidates"
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                View all
              </Link>
            }
          />
          {recentCandidates.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-5" />}
              title="No candidates yet"
              description="Add a candidate and upload their resume to start building your pipeline."
              action={
                <Link
                  href="/candidates/new"
                  className={buttonStyles("primary", "sm")}
                >
                  Add candidate
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link
                    href={`/candidates/${candidate.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60"
                  >
                    <Avatar name={candidate.fullName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink">
                        {candidate.fullName}
                      </p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {candidate.currentTitle ?? "Title not set"}
                      </p>
                    </div>
                    <DocumentStatusBadge status={candidate.processingStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest processing"
            description="Most recent jobs"
          />
          {recentJobs.length === 0 ? (
            <EmptyState
              icon={<ActivityIcon className="size-5" />}
              title="Nothing processed yet"
              description="Uploaded documents appear here as they move through the pipeline."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentJobs.map((job) => (
                <li key={job.id} className="px-4 py-3">
                  <p className="truncate text-[13px] font-medium leading-snug text-ink">
                    {job.document?.originalFileName ?? "Document"}
                  </p>
                  {job.candidateName ? (
                    <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                      {job.candidateName}
                    </p>
                  ) : null}
                  {job.errorMessage ? (
                    <p className="mt-1 text-[11.5px] leading-snug text-critical">
                      {job.errorMessage}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <ProcessingJobStatusBadge status={job.status} />
                    <span className="text-[11.5px] text-ink-subtle">
                      {formatRelativeTime(job.updatedAt, referenceTime)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
