import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import {
  ProcessingStatusBadge,
  ReviewStateBadge,
} from "@/components/ui/StatusBadge";
import { MapPinIcon } from "@/components/ui/icons";
import { pluralize } from "@/lib/utils";
import type { Candidate } from "@/lib/types";

export function CandidateCard({ candidate }: { candidate: Candidate }) {
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
            {candidate.currentTitle}
          </p>
        </div>
        <ProcessingStatusBadge status={candidate.processingStatus} />
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <MapPinIcon className="size-3.5" />
          {candidate.location}
        </span>
        <span>
          {candidate.yearsOfExperience}{" "}
          {pluralize(candidate.yearsOfExperience, "year")} experience
        </span>
      </p>

      {candidate.skills.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {candidate.skills.slice(0, 5).map((skill) => (
            <Chip key={skill}>{skill}</Chip>
          ))}
          {candidate.skills.length > 5 ? (
            <Chip>+{candidate.skills.length - 5}</Chip>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-ink-muted">
        <span className="truncate">
          {candidate.primaryVacancyTitle ?? "No vacancy assigned"}
        </span>
        <ReviewStateBadge state={candidate.reviewState} />
      </div>
    </Card>
  );
}
