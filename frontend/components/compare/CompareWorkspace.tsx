"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  compareCandidatesAction,
  mapMissingCandidatesAction,
} from "@/app/(app)/compare/actions";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/LoadingSkeleton";
import { CitationLink } from "@/components/evidence/CitationLink";
import { Button } from "@/components/ui/Button";
import { EvidenceStatusBadge } from "@/components/ui/StatusBadge";
import { AlertIcon, CompareIcon, SparkIcon } from "@/components/ui/icons";
import {
  MAX_COMPARE_CANDIDATES,
  MIN_COMPARE_CANDIDATES,
} from "@/lib/constants";
import { MyVacancySelector } from "@/components/vacancies/MyVacancySelector";
import { CompareInsightsPanel } from "@/components/compare/CompareInsightsPanel";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  AiFailureReason,
  ComparisonResult,
  MyVacancy,
  VacancyCandidate,
} from "@/lib/types";

interface CompareWorkspaceProps {
  /** The caller's OWN vacancies, from /vacancies/mine. */
  vacancies: MyVacancy[];
  /**
   * The SELECTED vacancy's applicants, from /vacancies/:id/candidates. Never
   * an org-wide candidate directory filtered in the browser.
   */
  vacancyCandidates: VacancyCandidate[];
  activeVacancyId: string | null;
  invalidSelection: boolean;
  initialSelected: string[];
  initialResult: ComparisonResult | null;
}

/**
 * Who can actually be compared: any applicant of this vacancy with a document
 * to compare. Membership is already guaranteed by the endpoint, so nothing is
 * re-filtered by vacancy here.
 */
function comparablePool(rows: VacancyCandidate[]): VacancyCandidate[] {
  return rows.filter((row) => row.candidate.documentCount > 0);
}

export function CompareWorkspace({
  vacancies,
  vacancyCandidates,
  activeVacancyId,
  invalidSelection,
  initialSelected,
  initialResult,
}: CompareWorkspaceProps) {
  const { d, f } = useI18n();

  /**
   * The vacancy lives in the URL, so switching it re-runs the server component
   * and this whole workspace is remounted with the new vacancy's candidates.
   * That is what clears the previous selection, comparison table, evidence and
   * error state — there is no stale slice left to reset by hand.
   */
  const vacancyId = activeVacancyId ?? "";
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [result, setResult] = useState<ComparisonResult | null>(initialResult);
  const [loading, setLoading] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [failure, setFailure] = useState<{
    reason: AiFailureReason;
    message?: string;
  } | null>(null);

  // Guards against an earlier request resolving after a later one.
  const requestRef = useRef(0);

  const pool = useMemo(() => comparablePool(vacancyCandidates), [vacancyCandidates]);

  /** In the vacancy, but with nothing indexed to compare yet. */
  const pendingCount = vacancyCandidates.length - pool.length;

  const apply = useCallback(async (nextVacancyId: string, ids: string[]) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    if (!nextVacancyId || ids.length < MIN_COMPARE_CANDIDATES) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailure(null);
    try {
      const next = await compareCandidatesAction(nextVacancyId, ids);
      if (requestRef.current !== requestId) return;
      if (next.ok) setResult(next.data);
      else {
        setResult(null);
        setFailure({ reason: next.reason, message: next.message });
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  /**
   * Fills the columns of candidates that have never been mapped.
   *
   * `mapping` disables the control for the whole round trip, so a second click
   * cannot start a duplicate set of runs.
   */
  const runMissingMappings = useCallback(async () => {
    if (mapping || !vacancyId || selected.length < MIN_COMPARE_CANDIDATES) return;

    setMapping(true);
    setFailure(null);
    try {
      const next = await mapMissingCandidatesAction(vacancyId, selected);
      if (next.ok) setResult(next.data);
      else setFailure({ reason: next.reason, message: next.message });
    } finally {
      setMapping(false);
    }
  }, [mapping, vacancyId, selected]);

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

  const selector = (
    <MyVacancySelector
      vacancies={vacancies}
      value={activeVacancyId}
      invalid={invalidSelection}
    />
  );

  if (vacancies.length === 0 || !activeVacancyId) {
    return (
      <div className="flex flex-col gap-4">
        {selector}
        <Card>
          <EmptyState
            icon={<CompareIcon className="size-5" />}
            title={
              vacancies.length === 0
                ? d.compare.nothingToCompare
                : d.vacancyScope.selectFirstTitle
            }
            description={
              vacancies.length === 0
                ? d.compare.nothingToCompareHint
                : d.vacancyScope.selectFirstHint
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {selector}
      <Card>
        <CardHeader
          title={d.compare.selectTitle}
          description={f(d.compare.selectDescription, {
            min: MIN_COMPARE_CANDIDATES,
            max: MAX_COMPARE_CANDIDATES,
          })}
          action={
            <span className="text-[12.5px] text-ink-muted tabular-nums">
              {f(d.compare.selectedCount, {
                count: selected.length,
                max: MAX_COMPARE_CANDIDATES,
              })}
            </span>
          }
        />
        <CardBody className="flex flex-col gap-3">


          {pool.length === 0 ? (
            <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-[13px] text-ink-muted">
              {d.compare.noneProcessed}
            </p>
          ) : (
            <>
              {pendingCount > 0 ? (
                <p className="text-[12.5px] text-ink-muted">
                  {f(d.compare.processedRatio, {
                    ready: pool.length,
                    total: pool.length + pendingCount,
                  })}
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pool.map((row) => {
                  const candidate = row.candidate;
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
                          {candidate.currentTitle ?? d.common.notSet}
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

      {failure ? (
        <AiFailureNotice reason={failure.reason} message={failure.message} />
      ) : null}

      {loading || mapping ? (
        <>
          {mapping ? (
            <p
              role="status"
              aria-live="polite"
              className="text-[12.5px] text-ink-muted"
            >
              {d.compare.mappingRunning}
            </p>
          ) : null}
          <SkeletonTable rows={6} columns={4} />
        </>
      ) : null}

      {!loading && !mapping && selected.length < MIN_COMPARE_CANDIDATES ? (
        <Card>
          <EmptyState
            icon={<CompareIcon className="size-5" />}
            title={f(d.compare.selectAtLeast, { min: MIN_COMPARE_CANDIDATES })}
            description={d.compare.selectAtLeastHint}
          />
        </Card>
      ) : null}

      {/*
        Comparison intelligence, keyed on the exact selection so changing who
        is being compared discards the previous verdict instead of relabelling
        it. Sits above the evidence table: superlatives are the summary a
        recruiter scans first, the table is the detail behind it.
      */}
      {!loading && !mapping && vacancyId ? (
        <CompareInsightsPanel
          key={`${vacancyId}:${selected.join(",")}`}
          vacancyId={vacancyId}
          candidateIds={selected}
        />
      ) : null}

      {!loading && !mapping && result ? (
        <>
          {result.unmappedCandidateIds.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
              <span>
                {f(d.compare.unmappedNote, {
                  count: result.unmappedCandidateIds.length,
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ml-auto"
                loading={mapping}
                disabled={mapping}
                onClick={() => void runMissingMappings()}
                icon={<SparkIcon className="size-4" />}
              >
                {d.compare.runMapping}
              </Button>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card scrollbar-slim">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                {f(d.compare.tableCaption, { vacancy: result.vacancyTitle })}
              </caption>
              <thead>
                <tr className="border-b border-line bg-surface-muted">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-surface-muted px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle"
                  >
                    {d.compare.columnRequirement}
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
                        {candidate.currentTitle ?? d.common.notSet}
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
                          ? d.status.requirementPriority.required
                          : d.status.requirementPriority.optional}
                      </span>
                    </th>
                    {row.cells.map((cell) => (
                      <td
                        key={`${row.requirementId}-${cell.candidateId}`}
                        className="px-4 py-3 align-top"
                      >
                        <EvidenceStatusBadge status={cell.status} short />
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
              {d.compare.legendTitle}
            </p>
            <ul className="flex flex-col gap-1.5 text-[12.5px] text-ink-muted">
              <li className="flex flex-wrap items-center gap-2">
                <EvidenceStatusBadge status="FOUND" short />
                {d.compare.legendFound}
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <EvidenceStatusBadge status="NOT_FOUND" short />
                {d.compare.legendNotFound}
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <EvidenceStatusBadge status="NEEDS_REVIEW" short />
                {d.compare.legendReview}
              </li>
              <li className="flex flex-wrap items-center gap-2">
                <EvidenceStatusBadge status="NOT_RUN" short />
                {d.compare.legendNotRun}
              </li>
            </ul>
          </div>

          <p className="flex gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-warning">
            <AlertIcon className="mt-px size-4 shrink-0" />
            {d.compare.noWinner}
          </p>
        </>
      ) : null}
    </div>
  );
}
