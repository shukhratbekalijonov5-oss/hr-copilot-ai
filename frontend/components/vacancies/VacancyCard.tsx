"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Badge";
import { VacancyStatusBadge } from "@/components/ui/StatusBadge";
import { BriefcaseIcon, MapPinIcon, UsersIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { Vacancy } from "@/lib/types";

export function VacancyCard({ vacancy }: { vacancy: Vacancy }) {
  const { d, f, p, date } = useI18n();

  const mustHaves = vacancy.requirements.filter(
    (requirement) => requirement.required,
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
              {vacancy.department ?? d.dashboard.noDepartment}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPinIcon className="size-3.5" />
              {vacancy.location ?? d.tables.locationNotSet}
            </span>
          </p>
        </div>
        <VacancyStatusBadge status={vacancy.status} />
      </div>

      {mustHaves.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mustHaves.slice(0, 4).map((requirement) => (
            <Chip key={requirement.id}>{requirement.text}</Chip>
          ))}
          {mustHaves.length > 4 ? (
            <Chip>{f(d.tables.more, { count: mustHaves.length - 4 })}</Chip>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <UsersIcon className="size-3.5" />
          {p(d.common.candidates, vacancy.candidateCount)}
        </span>
        <span>
          {vacancy.employmentType
            ? `${d.employmentType[vacancy.employmentType as keyof typeof d.employmentType] ?? vacancy.employmentType} · `
            : ""}
          {date(vacancy.createdAt)}
        </span>
      </div>
    </Card>
  );
}
