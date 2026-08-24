"use client";

import Link from "next/link";
import {
  CandidateCard,
  CandidateEmptyState,
  CandidateErrorState,
  SectionHeader,
} from "@/components/candidate/ui";
import { CandidateStageBadge } from "@/components/candidate/ui/CandidateStageBadge";
import { BriefcaseIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Pipeline, PipelineStage } from "@/lib/candidate/dashboard";
import type { MyApplication } from "@/lib/types";

const STAGES: PipelineStage[] = ["applied", "review", "interview", "decision"];

/**
 * Applied → In review → Interview → Decision, plus the newest applications.
 *
 * ## The funnel is counts, not a progress bar
 *
 * Each column is how many applications are sitting at that stage right now.
 * It is deliberately NOT drawn as one advancing bar: a person has many
 * applications at once, and a single bar would have to pretend they move
 * together. The connectors are decoration and are hidden from assistive tech;
 * the numbers and their labels carry everything.
 */
export function DashboardPipeline({
  pipeline,
  recent,
  failed,
}: {
  pipeline: Pipeline;
  recent: MyApplication[];
  failed: boolean;
}) {
  const { d, date } = useI18n();
  const copy = d.home.pipeline;

  const label: Record<PipelineStage, string> = {
    applied: copy.applied,
    review: copy.review,
    interview: copy.interview,
    decision: copy.decision,
  };

  if (failed) {
    return (
      <section>
        <SectionHeader title={copy.title} />
        <CandidateErrorState
          title={copy.title}
          description={d.common.retry}
          action={
            <Link
              href="/my-applications"
              className="text-[13px] font-medium text-brand hover:text-brand-hover"
            >
              {copy.viewAll}
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="pipeline-title">
      <SectionHeader
        id="pipeline-title"
        title={copy.title}
        description={copy.description}
        action={
          <Link
            href="/my-applications"
            className="text-[12.5px] font-medium text-brand transition-colors duration-[var(--motion-fast)] hover:text-brand-hover"
          >
            {copy.viewAll}
          </Link>
        }
      />

      <CandidateCard className="p-4">
        <ol className="flex items-stretch gap-1.5">
          {STAGES.map((stage, index) => (
            <li key={stage} className="flex min-w-0 flex-1 items-center gap-1.5">
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-[10px] border px-2.5 py-2.5 text-center",
                  "transition-colors duration-[var(--motion-fast)]",
                  // An occupied stage is tinted; an empty one stays quiet, so
                  // the shape of someone's search is readable at a glance.
                  pipeline[stage] > 0
                    ? "border-brand/20 bg-brand-soft/60"
                    : "border-line bg-surface-muted/50",
                )}
              >
                <p
                  className={cn(
                    "text-[21px] font-semibold leading-none tabular-nums tracking-[-0.03em]",
                    pipeline[stage] > 0 ? "text-brand-ink" : "text-ink-subtle",
                  )}
                >
                  {pipeline[stage]}
                </p>
                <p className="mt-1.5 truncate text-[11.5px] leading-tight text-ink-muted">
                  {label[stage]}
                </p>
              </div>
              {index < STAGES.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="hidden h-px w-2 shrink-0 bg-line sm:block"
                />
              ) : null}
            </li>
          ))}
        </ol>

        {recent.length === 0 ? (
          <div className="mt-4 border-t border-line pt-4">
            <CandidateEmptyState
              icon={<BriefcaseIcon className="size-4.5" />}
              title={copy.empty}
              description={copy.emptyHint}
              className="border-0 py-6"
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-[var(--line)] border-t border-line">
            {recent.map((application) => (
              <li key={application.id}>
                <Link
                  href={`/jobs/${application.job.publicSlug}`}
                  className="flex items-center gap-3 py-2.5 transition-colors duration-[var(--motion-fast)] hover:bg-surface-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {application.job.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                      {application.job.organizationName} ·{" "}
                      {date(application.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <CandidateStageBadge status={application.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CandidateCard>
    </section>
  );
}
