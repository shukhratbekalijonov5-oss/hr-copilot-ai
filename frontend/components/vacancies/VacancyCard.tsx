import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { VacancyStatusBadge } from "@/components/ui/StatusBadge";
import { BriefcaseIcon, MapPinIcon, UsersIcon } from "@/components/ui/icons";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants";
import { formatDate, pluralize } from "@/lib/utils";
import type { Vacancy } from "@/lib/types";

export function VacancyCard({ vacancy }: { vacancy: Vacancy }) {
  const mustHaves = vacancy.requirements.filter(
    (requirement) => requirement.kind === "must_have",
  );

  return (
    <Card className="flex flex-col p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink">
            <Link href={`/vacancies/${vacancy.id}`} className="hover:text-brand">
              {vacancy.title}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <BriefcaseIcon className="size-3.5" />
              {vacancy.department}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3.5" />
              {vacancy.location}
            </span>
          </p>
        </div>
        <VacancyStatusBadge status={vacancy.status} />
      </div>

      {mustHaves.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mustHaves.slice(0, 4).map((requirement) => (
            <Chip key={requirement.id}>{requirement.label}</Chip>
          ))}
          {mustHaves.length > 4 ? (
            <Chip>+{mustHaves.length - 4} more</Chip>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <UsersIcon className="size-3.5" />
          {vacancy.candidateCount}{" "}
          {pluralize(vacancy.candidateCount, "candidate")}
        </span>
        <span>
          {EMPLOYMENT_TYPE_LABELS[vacancy.employmentType]} ·{" "}
          {formatDate(vacancy.createdAt)}
        </span>
      </div>
    </Card>
  );
}
