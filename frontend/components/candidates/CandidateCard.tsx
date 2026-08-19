"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { MapPinIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { Candidate } from "@/lib/types";

export function CandidateCard({ candidate }: { candidate: Candidate }) {
  const { d, p } = useI18n();

  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3">
        <Avatar name={candidate.fullName} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">
            <Link
              href={`/candidates/${candidate.id}`}
              className="hover:text-brand"
            >
              {candidate.fullName}
            </Link>
          </h3>
          <p className="truncate text-[13px] text-ink-muted">
            {candidate.currentTitle ?? d.common.notSet}
          </p>
        </div>
        <DocumentStatusBadge status={candidate.processingStatus} />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="size-3.5" />
          {candidate.location ?? d.tables.locationNotSet}
        </span>
        {candidate.totalExperienceYears !== null ? (
          <span>{p(d.tables.yearsExperience, candidate.totalExperienceYears)}</span>
        ) : null}
      </p>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-ink-muted">
        <span className="truncate">
          {candidate.primaryVacancyTitle ?? d.tables.noVacancyAssigned}
        </span>
        <Chip>{p(d.common.documents, candidate.documents.length)}</Chip>
      </div>
    </Card>
  );
}
