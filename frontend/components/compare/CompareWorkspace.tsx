"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { compareCandidatesAction } from "@/app/(app)/compare/actions";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/LoadingSkeleton";
import { CitationLink } from "@/components/evidence/CitationLink";
import { AlertIcon, CompareIcon } from "@/components/ui/icons";
import {
  MAX_COMPARE_CANDIDATES,
  MIN_COMPARE_CANDIDATES,
  REQUIREMENT_PRIORITY_LABELS,
} from "@/lib/constants";
import { cn, pluralize } from "@/lib/utils";
import type {
  Candidate,
  ComparisonResult,
  EvidenceStatus,
  Vacancy,
} from "@/lib/types";

/** Compact cell labels — the legend below the table spells them out. */
const CELL_LABELS: Record<EvidenceStatus, string> = {
  FOUND: "Found",
  NOT_FOUND: "Not found",
  NEEDS_REVIEW: "Review",
};

const CELL_TONES = {
  FOUND: "positive",
  NOT_FOUND: "neutral",
  NEEDS_REVIEW: "warning",
} as const;

interface CompareWorkspaceProps {
  /** Only vacancies that have candidates — the rest cannot be compared. */
  vacancies: Vacancy[];
  candidates: Candidate[];
  initialVacancyId: string;
  initialSelected: string[];
  initialResult: ComparisonResult | null;
}

/** Candidates whose documents have finished indexing, for one vacancy. */
function poolFor(candidates: Candidate[], vacancyId: string): Candidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.primaryVacancyId === vacancyId &&
      candidate.processingStatus === "COMPLETED",
  );
}

function defaultSelection(pool: Candidate[]): string[] {
  return pool.slice(0, 3).map((candidate) => candidate.id);
}

export function CompareWorkspace({
  vacancies,
  candidates,
  initialVacancyId,
  initialSelected,
  initialResult,
}: CompareWorkspaceProps) {
  const [vacancyId, setVacancyId] = useState(initialVacancyId);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [result, setResult] = useState<ComparisonResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against an earlier request resolving after a later one.
  const requestRef = useRef(0);

  const pool = useMemo(
    () => poolFor(candidates, vacancyId),
    [candidates, vacancyId],
  );

  /** Attached to the vacancy but not yet analysable. */
  const pendingCount = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          candidate.primaryVacancyId === vacancyId &&
          candidate.processingStatus !== "COMPLETED",
      ).length,
    [candidates, vacancyId],
  );

  const apply = useCallback(async (nextVacancyId: string, ids: string[]) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    if (!nextVacancyId || ids.length < MIN_COMPARE_CANDIDATES) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await compareCandidatesAction(nextVacancyId, ids);
      if (requestRef.current !== requestId) return;
      if (next.ok) setResult(next.result);
      else {
        setResult(null);
        setError(next.message);
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  function changeVacancy(nextVacancyId: string) {
    const nextSelection = defaultSelection(poolFor(candidates, nextVacancyId));
    setVacancyId(nextVacancyId);
    setSelected(nextSelection);
    void apply(nextVacancyId, nextSelection);
  }

  function toggle(candidateId: string) {
    const next = selected.includes(candidateId)
      ? selected.filter((id) => id !== candidateId)
      : selected.length >= MAX_COMPARE_CANDIDATES
        ? selected
        : [...selected, candidateId];

    if (next === selected) return;
    setSelected(next);
    void apply(vacancyId, next);
  }

  if (vacancies.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<CompareIcon className="size-5" />}
          title="Nothing to compare yet"
          description="Once a vacancy has candidates with indexed resumes, you can line their requirement evidence up side by side."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Select candidates"
          description={`Pick ${MIN_COMPARE_CANDIDATES}–${MAX_COMPARE_CANDIDATES} candidates from one vacancy.`}
          action={
            <span className="text-[12.5px] text-ink-muted tabular-nums">
              {selected.length} / {MAX_COMPARE_CANDIDATES}
            </span>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <Select
            label="Vacancy"
            value={vacancyId}
            options={vacancies.map((vacancy) => ({
              value: vacancy.id,
              label: `${vacancy.title} (${vacancy.candidateCount} ${pluralize(vacancy.candidateCount, "candidate")})`,
            }))}
            onChange={(event) => changeVacancy(event.target.value)}
            className="sm:max-w-md"
          />

          {pool.length === 0 ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-[13px] text-ink-muted">
              No candidate on this vacancy has finished processing yet.
            </p>
          ) : (
            <>
              {pendingCount > 0 ? (
                <p className="text-[12.5px] text-ink-muted">
                  {pool.length} of {pool.length + pendingCount} candidates on this
                  vacancy have finished processing. The rest appear here once
                  their documents are indexed.
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pool.map((candidate) => {
                  const checked = selected.includes(candidate.id);
                  const atLimit =
                    !checked && selected.length >= MAX_COMPARE_CANDIDATES;

                  return (
                    <label
                      key={candidate.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors",
                        checked
                          ? "border-brand bg-brand-soft/50"
                          : "border-line hover:border-line-strong",
                        atLimit && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggle(candidate.id)}
                        className="mt-0.5 size-4 shrink-0 rounded border-line-strong accent-[var(--brand)]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {candidate.fullName}
                        </span>
                        <span className="block truncate text-[12px] text-ink-muted">
                          {candidate.currentTitle ?? "Title not set"}
                        </span>
                      </span>
                    </label>
                  );
                })}
                </div>
            </>
          )}
        </CardBody>
      </Card>

      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {loading ? <SkeletonTable rows={6} columns={4} /> : null}

      {!loading && selected.length < MIN_COMPARE_CANDIDATES ? (
        <Card>
          <EmptyState
            icon={<CompareIcon className="size-5" />}
            title={`Select at least ${MIN_COMPARE_CANDIDATES} candidates`}
            description="The comparison lines up requirement evidence from each candidate's documents."
          />
        </Card>
      ) : null}

      {!loading && result ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card scrollbar-slim">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Requirement evidence for {result.vacancyTitle}
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-muted">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-surface-muted px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle"
                  >
                    Requirement
                  </th>
                  {result.candidates.map((candidate) => (
                    <th
                      key={candidate.id}
                      scope="col"
                      className="px-4 py-2.5 text-left align-bottom"
                    >
                      <Link
                        href={`/candidates/${candidate.id}`}
                        className="block text-[13px] font-semibold text-ink hover:text-brand"
                      >
                        {candidate.fullName}
                      </Link>
                      <span className="block truncate text-[11.5px] font-normal normal-case text-ink-muted">
                        {candidate.currentTitle ?? "Title not set"}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr
                    key={row.requirementId}
                    className="border-b border-line last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-surface px-4 py-3 text-left align-top"
                    >
                      <span className="block text-[13px] font-medium text-ink">
                        {row.requirementText}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] font-normal text-ink-subtle">
                        {row.required
                          ? REQUIREMENT_PRIORITY_LABELS.required
                          : REQUIREMENT_PRIORITY_LABELS.optional}
                      </span>
                    </th>
                    {row.cells.map((cell) => (
                      <td
                        key={`${row.requirementId}-${cell.candidateId}`}
                        className="px-4 py-3 align-top"
                      >
                        <Badge tone={CELL_TONES[cell.status]}>
                          {CELL_LABELS[cell.status]}
                        </Badge>
                        {cell.citation ? (
                          <div className="mt-1.5">
                            <CitationLink
                              citation={cell.citation}
                              href={`/candidates/${cell.candidateId}`}
                            />
                          </div>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-3.5 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              What the cells mean
            </p>
            <ul className="flex flex-col gap-1.5 text-[12.5px] text-ink-muted">
              <li className="flex items-center gap-2">
                <Badge tone="positive">Found</Badge>
                A passage in the documents supports this requirement.
              </li>
              <li className="flex items-center gap-2">
                <Badge tone="neutral">Not found</Badge>
                Nothing in the documents mentions it. Absence of evidence, not
                evidence of absence.
              </li>
              <li className="flex items-center gap-2">
                <Badge tone="warning">Review</Badge>
                Something related was found, but it needs a person to judge it.
              </li>
            </ul>
          </div>

          <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning">
            <AlertIcon className="mt-px size-4 shrink-0" />
            This table compares what the documents contain. It does not rank
            candidates or recommend a hire — that decision stays with you.
          </p>
        </>
      ) : null}
    </div>
  );
}
