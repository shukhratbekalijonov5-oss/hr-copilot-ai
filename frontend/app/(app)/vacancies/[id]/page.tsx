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
import { CompareIcon, PlusIcon, UsersIcon } from "@/components/ui/icons";
import {
  REQUIREMENT_PRIORITY_LABELS,
  REQUIREMENT_TYPE_LABELS,
} from "@/lib/constants";
import { formatDate, pluralize } from "@/lib/utils";
import type { Vacancy } from "@/lib/types";

export async function generateMetadata(
  props: PageProps<"/vacancies/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const vacancy = await api.getVacancy(id);
    return { title: vacancy.title };
  } catch {
    return { title: "Vacancy" };
  }
}

export default async function VacancyDetailPage(
  props: PageProps<"/vacancies/[id]">,
) {
  await requireSession();
  const { id } = await props.params;

  let vacancy: Vacancy;
  try {
    vacancy = await api.getVacancy(id);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  const { applications } = await api.getApplications({ vacancyId: vacancy.id });

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
          { label: "Vacancies", href: "/vacancies" },
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
                <span>{vacancy.employmentType}</span>
              </>
            ) : null}
            {vacancy.experienceLevel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{vacancy.experienceLevel}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(vacancy.createdAt)}</span>
          </div>
        }
        actions={
          <>
            <Link
              href={`/compare?vacancy=${vacancy.id}`}
              className={buttonStyles("secondary", "md")}
            >
              <CompareIcon className="size-4" />
              Compare
            </Link>
            <Link
              href={`/candidates/new?vacancy=${vacancy.id}`}
              className={buttonStyles("primary", "md")}
            >
              <PlusIcon className="size-4" />
              Add candidate
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Job description" />
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
                  No description was added for this vacancy.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Requirements"
              description={`${mustHaves.length} must have · ${niceToHaves.length} nice to have`}
            />
            {vacancy.requirements.length === 0 ? (
              <EmptyState
                title="No requirements yet"
                description="Requirements are what each uploaded resume is checked against. Without them there is nothing to find evidence for."
              />
            ) : (
              <CardBody className="flex flex-col gap-4">
                {mustHaves.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                      {REQUIREMENT_PRIORITY_LABELS.required}
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
                            {REQUIREMENT_TYPE_LABELS[requirement.type]}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {niceToHaves.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                      {REQUIREMENT_PRIORITY_LABELS.optional}
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

          <Card>
            <CardHeader
              title="Candidates"
              description={`${applications.length} ${pluralize(applications.length, "candidate")} attached to this vacancy`}
              action={
                <Link
                  href={`/candidates?vacancy=${vacancy.id}`}
                  className="text-[12.5px] font-medium text-brand hover:underline"
                >
                  View all
                </Link>
              }
            />
            {applications.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="size-5" />}
                title="No candidates yet"
                description="Add a candidate and upload their resume — each one is checked against the requirements above."
                action={
                  <Link
                    href={`/candidates/new?vacancy=${vacancy.id}`}
                    className={buttonStyles("primary", "sm")}
                  >
                    Add candidate
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {applications.map((application) => (
                  <li key={application.id}>
                    <Link
                      href={`/candidates/${application.candidateId}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/60"
                    >
                      <Avatar
                        name={application.candidate?.fullName ?? "?"}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {application.candidate?.fullName ?? "Candidate"}
                        </p>
                        <p className="truncate text-[12.5px] text-ink-muted">
                          {application.candidate?.currentTitle ??
                            "Title not set"}
                        </p>
                      </div>
                      <ApplicationStatusBadge status={application.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="At a glance" />
            <CardBody>
              <dl className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">Candidates</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-ink">
                    {applications.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">Requirements</dt>
                  <dd className="text-[15px] font-semibold tabular-nums text-ink">
                    {vacancy.requirements.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] text-ink-muted">Last updated</dt>
                  <dd className="text-[13px] text-ink">
                    {formatDate(vacancy.updatedAt)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reading resumes" />
            <CardBody className="flex flex-col gap-3">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Documents attach to a candidate, not to a vacancy. Add the person
                first, then upload their resume from their page — that is what
                links the file to these requirements.
              </p>
              <Link
                href={`/candidates/new?vacancy=${vacancy.id}`}
                className={buttonStyles("secondary", "md", "self-start")}
              >
                <PlusIcon className="size-4" />
                Add candidate
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
