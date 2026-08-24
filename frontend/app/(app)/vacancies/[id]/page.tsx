import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  ApplicationStatusBadge,
  VacancyStatusBadge,
} from "@/components/ui/StatusBadge";
import { buttonStyles } from "@/components/ui/Button";
import { CompareIcon, EditIcon, MessageIcon, UsersIcon } from "@/components/ui/icons";
import { VacancyCloseButton } from "@/components/vacancies/VacancyCloseButton";
import { JobProfileSections } from "@/components/vacancies/JobProfileSections";
import { getI18n } from "@/lib/i18n/server";
import {
  attemptNumber,
  groupApplicantsByCandidate,
} from "@/lib/vacancy/applicants";
import { VACANCY_PARAM } from "@/lib/vacancy/selection";
import { formatDateFor } from "@/lib/i18n/format";
import { format, plural } from "@/lib/i18n/format";
import type { Vacancy } from "@/lib/types";

export async function generateMetadata(
  props: PageProps<"/vacancies/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const vacancy = await api.getVacancy(id);
    return { title: vacancy.title };
  } catch {
    const { d } = await getI18n();
    return { title: d.tables.vacancy };
  }
}

export default async function VacancyDetailPage(
  props: PageProps<"/vacancies/[id]">,
) {
  const session = await requireSession();
  const { locale, d } = await getI18n();
  const { id } = await props.params;

  let vacancy: Vacancy;
  try {
    vacancy = await api.getVacancy(id);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  const [applications, conversationsPage] = await Promise.all([
    // Every attempt, all pages: the list below is grouped by candidate, and
    // grouping only page 1 would both split a person across pages and make
    // the applicant count report attempts instead of people.
    api.getAllApplications({ vacancyId: vacancy.id }),
    api.getOrganizationConversations({ vacancyId: vacancy.id, page: 1, limit: 100 }),
  ]);
  /**
   * One row per candidate, not per application.
   *
   * A candidate who was rejected and re-applied holds several applications to
   * this vacancy. They are one applicant, so they get one row, driven by their
   * newest attempt — every earlier attempt stays intact underneath it.
   */
  const applicants = groupApplicantsByCandidate(applications);
  const conversationByCandidate = new Map(
    conversationsPage.conversations.map((conversation) => [
      conversation.candidate.id,
      conversation,
    ]),
  );

  const mustHaves = vacancy.requirements.filter(
    (requirement) => requirement.required,
  );
  const niceToHaves = vacancy.requirements.filter(
    (requirement) => !requirement.required,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        breadcrumbs={[
          { label: d.vacancies.title, href: "/vacancies" },
          { label: vacancy.title },
        ]}
        title={vacancy.title}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-muted">
            <VacancyStatusBadge status={vacancy.status} />
            {vacancy.department ? <span>{vacancy.department}</span> : null}
            {vacancy.location ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{vacancy.location}</span>
              </>
            ) : null}
            {vacancy.employmentType ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {d.employmentType[
                    vacancy.employmentType as keyof typeof d.employmentType
                  ] ?? vacancy.employmentType}
                </span>
              </>
            ) : null}
            {vacancy.experienceLevel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {d.experienceLevel[
                    vacancy.experienceLevel as keyof typeof d.experienceLevel
                  ] ?? vacancy.experienceLevel}
                </span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>
              {format(d.vacancyDetail.created, {
                date: formatDateFor(vacancy.createdAt, d),
              })}
            </span>
          </div>
        }
        actions={
          <>
            {/*
              Shown to the creator only — but that is presentation, not
              authorization. The PATCH behind the form is re-checked
              server-side, so a colleague who reaches the URL is refused
              there.
            */}
            {vacancy.createdById === session.id ? (
              <Link
                href={`/vacancies/${vacancy.id}/edit`}
                className={buttonStyles("secondary", "md")}
              >
                <EditIcon className="size-4" />
                {d.common.edit}
              </Link>
            ) : null}
            <Link
              href={`/compare?vacancyId=${vacancy.id}`}
              className={buttonStyles("secondary", "md")}
            >
              <CompareIcon className="size-4" />
              {d.nav.compare}
            </Link>
            {vacancy.status !== "CLOSED" && vacancy.status !== "ARCHIVED" ? (
              <VacancyCloseButton
                vacancyId={vacancy.id}
                chatCount={conversationsPage.conversations.length}
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title={d.vacancyDetail.jobDescription} />
            <CardBody>
              {vacancy.description ? (
                <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-muted">
                  {vacancy.description
                    .split("\n")
                    .filter((paragraph) => paragraph.trim())
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                </div>
              ) : (
                <p className="text-[13.5px] text-ink-muted">
                  {d.vacancyDetail.noDescription}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={d.vacancyDetail.requirements}
              description={format(d.vacancyDetail.requirementsSplit, {
                must: mustHaves.length,
                nice: niceToHaves.length,
              })}
            />
            {vacancy.requirements.length === 0 ? (
              <EmptyState
                title={d.vacancyDetail.noRequirements}
                description={d.vacancyDetail.noRequirementsHint}
              />
            ) : (
              <CardBody className="flex flex-col gap-4">
                {mustHaves.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                      {d.status.requirementPriority.required}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {mustHaves.map((requirement) => (
                        <li
                          key={requirement.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2"
                        >
                          <span className="text-[13.5px] font-medium text-ink">
                            {requirement.text}
                          </span>
                          <Badge>
                            {d.status.requirementType[requirement.type]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {niceToHaves.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                      {d.status.requirementPriority.optional}
                    </p>
                    <ul className="flex flex-wrap gap-1.5">
                      {niceToHaves.map((requirement) => (
                        <li key={requirement.id}>
                          <Badge>{requirement.text}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardBody>
            )}
          </Card>

          {/*
            Everything the employer actually stated about the role. Rendered
            from the SAME component the candidate-facing posting uses, so the
            two can never describe the job differently.
          */}
          <JobProfileSections
            profile={vacancy}
            legacyLocation={vacancy.location}
            languages={vacancy.languages}
            d={d}
          />

          <Card>
            <CardHeader
              title={d.candidates.title}
              description={plural(
                d.vacancyDetail.candidatesAttached,
                applicants.length,
                locale,
              )}
              action={
                <Link
                  href={`/candidates?vacancyId=${vacancy.id}`}
                  className="text-[12.5px] font-medium text-brand hover:underline"
                >
                  {d.common.viewAll}
                </Link>
              }
            />
            {applicants.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="size-5" />}
                title={d.vacancyDetail.noCandidates}
                description={d.vacancyDetail.noCandidatesHint}
              />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {applicants.map((applicant) => {
                  const conversation = conversationByCandidate.get(
                    applicant.candidateId,
                  );
                  // Everything operational reads the CURRENT attempt: the
                  // stage badge, the applied date, and any id an action needs.
                  const current = applicant.current;
                  return (
                  <li key={applicant.candidateId} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                    <Link
                      href={`/candidates/${applicant.candidateId}?${VACANCY_PARAM}=${vacancy.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-brand"
                    >
                      <Avatar
                        name={applicant.candidate?.fullName ?? "?"}
                        src={applicant.candidate?.avatarUrl ?? null}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {applicant.candidate?.fullName ?? d.tables.candidate}
                        </p>
                        <p className="truncate text-[12.5px] text-ink-muted">
                          {applicant.candidate?.currentTitle ??
                            d.common.notSet}
                        </p>
                      </div>
                      {applicant.attemptCount > 1 ? (
                        <Badge>
                          {plural(
                            d.attempts.count,
                            applicant.attemptCount,
                            locale,
                          )}
                        </Badge>
                      ) : null}
                      <ApplicationStatusBadge status={current.status} />
                    </Link>
                    {conversation ? (
                      <Link
                        href={`/interview-chats?conversation=${conversation.id}`}
                        className={buttonStyles("secondary", "sm")}
                      >
                        <MessageIcon className="size-4" />
                        {d.chat.openChat}
                      </Link>
                    ) : null}
                    </div>

                    {/*
                      Earlier attempts, read-only. A plain <details> so the
                      history needs no client bundle and still works with no
                      JS; only the candidates who actually re-applied get it.
                    */}
                    {applicant.attemptCount > 1 ? (
                      <details className="group mt-2 pl-11">
                        <summary className="w-fit cursor-pointer list-none text-[12px] font-medium text-brand hover:underline">
                          <span className="group-open:hidden">
                            {d.attempts.viewHistory}
                          </span>
                          <span className="hidden group-open:inline">
                            {d.attempts.hideHistory}
                          </span>
                        </summary>
                        <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                          {d.attempts.history}
                        </p>
                        <ol className="mt-1.5 flex flex-col gap-1.5">
                          {applicant.attempts.map((attempt, index) => (
                            <li
                              key={attempt.id}
                              className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted"
                            >
                              <span className="text-ink">
                                {format(d.attempts.label, {
                                  number: attemptNumber(applicant, index),
                                })}
                              </span>
                              <ApplicationStatusBadge status={attempt.status} />
                              <span>
                                {format(d.candidates.appliedOn, {
                                  date: formatDateFor(attempt.createdAt, d),
                                })}
                              </span>
                              {attempt.id === current.id ? (
                                <Badge>{d.attempts.current}</Badge>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={d.vacancyDetail.atAGlance} />
            <CardBody>
              <dl className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">
                    {d.candidates.title}
                  </dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-ink">
                    {applicants.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">
                    {d.vacancyDetail.requirements}
                  </dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-ink">
                    {vacancy.requirements.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">
                    {d.vacancyDetail.lastUpdated}
                  </dt>
                  <dd className="text-[13px] text-ink">
                    {formatDateFor(vacancy.updatedAt, d)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={d.vacancyDetail.readingResumes} />
            <CardBody>
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {d.vacancyDetail.readingResumesHint}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
