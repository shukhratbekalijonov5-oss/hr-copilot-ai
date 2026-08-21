import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Chip } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SaveJobButton } from "@/components/jobs/SaveJobButton";
import { ApplyPanel } from "@/components/jobs/ApplyPanel";
import { BriefcaseIcon } from "@/components/ui/icons";
import { format, formatDateFor } from "@/lib/i18n/format";
import { applyEligibility } from "@/lib/candidate/apply-eligibility";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(
  props: PageProps<"/jobs/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const job = await api.getPublicJob(slug);
  if (job) return { title: job.title };
  const d = await getTranslations();
  return { title: d.jobs.title };
}

export default async function JobDetailPage(
  props: PageProps<"/jobs/[slug]">,
) {
  const { session } = await requirePersonalWorkspace();
  const { d } = await getI18n();
  const { slug } = await props.params;

  const job = await api.getPublicJob(slug);

  if (!job) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title={d.jobs.title}
          breadcrumbs={[{ label: d.jobs.title, href: "/jobs" }]}
        />
        <Card>
          <EmptyState
            icon={<BriefcaseIcon className="size-5" />}
            title={d.jobs.notFound}
            description={d.jobs.notFoundHint}
            action={
              <Link href="/jobs" className={buttonStyles("secondary", "sm")}>
                {d.jobs.backToJobs}
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  /**
   * Whether this person may apply right now.
   *
   * Read from their own application list rather than guessed, and judged on
   * the LATEST attempt rather than on "has any application ever existed".
   * A rejection ends an attempt, not the candidate's chance at the role, so
   * treating any past application as "already applied" is what used to lock
   * a rejected candidate out of the job permanently.
   */
  const [applications, saved] = await Promise.all([
    session.hasCandidateAccount
      ? api.getMyApplications(1, 100).catch(() => ({ applications: [] }))
      : Promise.resolve({ applications: [] }),
    session.hasCandidateAccount
      ? api.getSavedJobs(1, 100).catch(() => ({ saved: [] }))
      : Promise.resolve({ saved: [] }),
  ]);

  const eligibility = applyEligibility(
    applications.applications,
    job.publicSlug,
  );
  const isSaved = saved.saved.some((item) => item.job.publicSlug === slug);

  const mustHave = job.requirements.filter((item) => item.required);
  const niceToHave = job.requirements.filter((item) => !item.required);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: d.jobs.title, href: "/jobs" },
          { label: job.title },
        ]}
        title={job.title}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-ink-muted">
            <span className="font-medium text-ink">{job.organizationName}</span>
            {job.location ? <span>· {job.location}</span> : null}
            {job.employmentType ? (
              <span>
                ·{" "}
                {d.employmentType[
                  job.employmentType as keyof typeof d.employmentType
                ] ?? job.employmentType}
              </span>
            ) : null}
            {job.experienceLevel ? (
              <span>
                ·{" "}
                {d.experienceLevel[
                  job.experienceLevel as keyof typeof d.experienceLevel
                ] ?? job.experienceLevel}
              </span>
            ) : null}
            <span>
              ·{" "}
              {format(d.jobs.postedOn, {
                date: formatDateFor(job.createdAt, d),
              })}
            </span>
          </div>
        }
        actions={<SaveJobButton slug={job.publicSlug} saved={isSaved} />}
      />

      <div className="flex flex-col gap-4">
        <ApplyPanel
          slug={job.publicSlug}
          organizationName={job.organizationName}
          eligibility={eligibility}
          hasCandidateAccount={session.hasCandidateAccount}
        />

        <Card>
          <CardHeader title={d.jobs.aboutRole} />
          <CardBody>
            {job.description ? (
              <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-muted">
                {job.description
                  .split("\n")
                  .filter((paragraph) => paragraph.trim())
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            ) : (
              <p className="text-[13.5px] text-ink-muted">
                {d.jobs.noDescription}
              </p>
            )}
          </CardBody>
        </Card>

        {job.requirements.length > 0 ? (
          <Card>
            <CardHeader title={d.jobs.requirements} />
            <CardBody className="flex flex-col gap-4">
              {mustHave.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                    {d.jobs.mustHave}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {mustHave.map((requirement, index) => (
                      <li
                        key={`${requirement.text}-${index}`}
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

              {niceToHave.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                    {d.jobs.niceToHave}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {niceToHave.map((requirement, index) => (
                      <li key={`${requirement.text}-${index}`}>
                        <Chip>{requirement.text}</Chip>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
