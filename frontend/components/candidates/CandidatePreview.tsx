"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { BriefcaseIcon, MapPinIcon, UsersIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { VACANCY_PARAM } from "@/lib/vacancy/selection";
import type { Candidate } from "@/lib/types";

/**
 * The selected candidate, previewed beside the list.
 *
 * ## It renders only what the list already carries
 *
 * The candidates endpoint returns identity, experience, location, document
 * statuses and the primary vacancy — so that is exactly what appears here.
 * No summary, no match score, no evidence: none of that is in this payload,
 * and fetching it per selection would turn a keyboard walk down the list into
 * a burst of AI calls. Everything deeper lives one click away in the full
 * detail page, which is built for it.
 *
 * ## Vacancy context travels with the link
 *
 * "Open full detail" carries the selected vacancy in the URL, so the detail
 * page opens in the same scope the recruiter was working in rather than
 * resetting to a default. The backend re-validates that association either
 * way; this only keeps the workflow intact.
 */
export function CandidatePreview({
  candidate,
  vacancyId,
}: {
  candidate: Candidate;
  /** The list's active vacancy filter, or "all". */
  vacancyId: string;
}) {
  const { d, p } = useI18n();

  const scoped = vacancyId !== "all" ? vacancyId : candidate.primaryVacancyId;
  const detailHref = scoped
    ? `/candidates/${candidate.id}?${VACANCY_PARAM}=${encodeURIComponent(scoped)}`
    : `/candidates/${candidate.id}`;

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-line p-5">
        <Avatar name={candidate.fullName} src={candidate.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[18px] font-semibold tracking-[-0.015em] text-ink">
            {candidate.fullName}
          </h2>
          <p className="mt-0.5 truncate text-[13.5px] text-ink-muted">
            {candidate.currentTitle ?? d.common.notSet}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
            {candidate.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPinIcon className="size-3.5 shrink-0" />
                <span className="truncate">{candidate.location}</span>
              </span>
            ) : null}
            {candidate.totalExperienceYears !== null ? (
              <span className="tabular-nums">
                {p(d.tables.yearsShort, candidate.totalExperienceYears)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {/* The vacancy this reading sits inside, stated rather than implied. */}
        <section>
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
            {d.candidates.vacancyContext}
          </h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] text-ink">
            <BriefcaseIcon className="size-4 shrink-0 text-ink-subtle" />
            <span className="min-w-0 truncate">
              {candidate.primaryVacancyTitle ?? d.tables.empty}
            </span>
          </p>
        </section>

        <section>
          <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-subtle">
            {d.tables.documents}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              {p(d.tables.documentsCount, candidate.documentCount)}
            </Badge>
            {/* The worst-case status the backend derived — never recomputed. */}
            {candidate.processingStatus ? (
              <DocumentStatusBadge status={candidate.processingStatus} />
            ) : null}
          </div>
        </section>
      </div>

      {/*
        Sticky so the actions stay reachable while a long preview scrolls,
        and bordered so it never floats over the content it belongs to.
      */}
      <div className="sticky bottom-0 mt-auto flex flex-wrap gap-2 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur-sm">
        <Link href={detailHref} className={buttonStyles("primary", "sm")}>
          {d.candidates.openFullDetail}
        </Link>
        <Link
          href={scoped ? `/compare?${VACANCY_PARAM}=${encodeURIComponent(scoped)}` : "/compare"}
          className={buttonStyles("secondary", "sm")}
        >
          <UsersIcon className="size-4" />
          {d.nav.compare}
        </Link>
      </div>
    </div>
  );
}
