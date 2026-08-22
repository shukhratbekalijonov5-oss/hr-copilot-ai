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
  UsersIcon,
} from "@/components/ui/icons";
import { getI18n } from "@/lib/i18n/server";
import { formatRelativeTimeFor, plural } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: d.dashboard.title };
}

export default async function DashboardPage() {
  await requireSession();
  const { locale, d } = await getI18n();

  const quickActions = [
    {
      href: "/vacancies/new",
      label: d.dashboard.quickCreateVacancy,
      description: d.dashboard.quickCreateVacancyHint,
      icon: PlusIcon,
    },
    {
      href: "/candidates",
      label: d.dashboard.quickReviewApplicants,
      description: d.dashboard.quickReviewApplicantsHint,
      icon: UsersIcon,
    },
  ];

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
        title={d.dashboard.title}
        description={d.dashboard.description}
        actions={
          <Link href="/vacancies/new" className={buttonStyles("primary", "md")}>
            <PlusIcon className="size-4" />
            {d.dashboard.newVacancy}
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={d.dashboard.statTotalCandidates}
          value={stats.totalCandidates}
          href="/candidates"
          icon={<UsersIcon className="size-4" />}
          hint={d.dashboard.statTotalCandidatesHint}
        />
        <StatCard
          label={d.dashboard.statActiveVacancies}
          value={stats.activeVacancies}
          href="/vacancies"
          icon={<BriefcaseIcon className="size-4" />}
          hint={d.dashboard.statActiveVacanciesHint}
        />
        <StatCard
          label={d.dashboard.statResumesProcessing}
          value={stats.resumesProcessing}
          href="/processing"
          icon={<ActivityIcon className="size-4" />}
          hint={d.dashboard.statResumesProcessingHint}
        />
        <StatCard
          label={d.dashboard.statCompletedAnalyses}
          value={stats.completedAnalyses}
          icon={<SparkIcon className="size-4" />}
          hint={d.dashboard.statCompletedAnalysesHint}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {quickActions.map((action) => {
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
            title={d.dashboard.recentVacancies}
            action={
              <Link
                href="/vacancies"
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                {d.common.viewAll}
              </Link>
            }
          />
          {recentVacancies.length === 0 ? (
            <EmptyState
              icon={<BriefcaseIcon className="size-5" />}
              title={d.dashboard.noVacancies}
              description={d.dashboard.noVacanciesHint}
              action={
                <Link
                  href="/vacancies/new"
                  className={buttonStyles("primary", "sm")}
                >
                  {d.vacancies.create}
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
                        {vacancy.department ?? d.dashboard.noDepartment} ·{" "}
                        {vacancy.location ?? d.dashboard.noLocation}
                      </p>
                    </div>
                    <span className="hidden text-[12.5px] text-ink-muted sm:block">
                      {plural(d.common.candidates, vacancy.candidateCount, locale)}
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
            title={d.dashboard.processingActivity}
            description={d.dashboard.processingActivityHint}
          />
          <CardBody>
            <ProcessingProgress summary={processing} />
            <Link
              href="/processing"
              className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline"
            >
              {d.dashboard.openProcessingQueue}
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={d.dashboard.recentCandidates}
            action={
              <Link
                href="/candidates"
                className="text-[12.5px] font-medium text-brand hover:underline"
              >
                {d.common.viewAll}
              </Link>
            }
          />
          {recentCandidates.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="size-5" />}
              title={d.dashboard.noCandidates}
              description={d.dashboard.noCandidatesHint}
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link
                    href={`/candidates/${candidate.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60"
                  >
                    <Avatar
                      name={candidate.fullName}
                      src={candidate.avatarUrl}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink">
                        {candidate.fullName}
                      </p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {candidate.currentTitle ?? d.common.notSet}
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
            title={d.dashboard.latestProcessing}
            description={d.dashboard.latestProcessingHint}
          />
          {recentJobs.length === 0 ? (
            <EmptyState
              icon={<ActivityIcon className="size-5" />}
              title={d.dashboard.nothingProcessed}
              description={d.dashboard.nothingProcessedHint}
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentJobs.map((job) => (
                <li key={job.id} className="px-4 py-3">
                  <p className="truncate text-[13px] font-medium leading-snug text-ink">
                    {job.document?.originalFileName ?? d.dashboard.document}
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
                      {formatRelativeTimeFor(job.updatedAt, d, locale, referenceTime)}
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
