"use client";

import Link from "next/link";
import { use } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { AlertIcon, FileIcon, SearchIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { EvidenceFetchResult } from "@/lib/search/grounded-search";

interface EvidenceResultsProps {
  /** Started by the page without awaiting; this component suspends on it. */
  result: Promise<EvidenceFetchResult>;
}

/**
 * The retrieval half of a search: matching candidates and the passages behind
 * them. Unchanged from the original search screen — results are passages from
 * indexed resumes, each shown with the document, page and section it came
 * from. Candidates are ordered by which had the strongest matching passage —
 * never scored, ranked by quality, or recommended.
 *
 * Renders independently of the generated summary above it: retrieval finishes
 * in a couple of seconds and must not wait for a 20-30s generation, and a
 * retrieval failure is reported here without touching a valid answer.
 */
export function EvidenceResults({ result }: EvidenceResultsProps) {
  const { d, f, p } = useI18n();
  const response = use(result);

  if (!response.ok) {
    if (response.unavailable) {
      return (
        <UnavailableState
          icon={<SparkIcon className="size-5" />}
          title={d.search.unavailable}
          description={d.search.unavailableHint}
        />
      );
    }
    return (
      <p
        role="alert"
        className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
      >
        <AlertIcon className="size-4 shrink-0" />
        {response.message || d.search.failed}
      </p>
    );
  }

  const { result: found } = response;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
        <span>{p(d.search.resultsCount, found.candidates.length)}</span>
        {found.reranked ? (
          <Badge tone="neutral">{d.search.reranked}</Badge>
        ) : null}
        <span className="ml-auto tabular-nums text-ink-subtle">
          {f(d.search.considered, {
            count: found.totalConsidered,
            ms: found.durationMs,
          })}
        </span>
      </div>

      {found.candidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<SearchIcon className="size-5" />}
            title={d.search.noResults}
            description={d.search.noResultsHint}
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {found.candidates.map((candidate) => (
            <li key={candidate.candidateId}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={candidate.candidateName ?? d.search.unnamedCandidate} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/candidates/${candidate.candidateId}`}
                      className="text-[15px] font-semibold tracking-tight text-ink hover:text-brand"
                    >
                      {candidate.candidateName ?? d.search.unnamedCandidate}
                    </Link>
                    <p className="text-[12.5px] text-ink-muted">
                      {p(d.common.passages, candidate.passages.length)}
                    </p>
                  </div>
                </div>

                <ul className="mt-3 flex flex-col gap-2.5">
                  {candidate.passages.map((passage, index) => (
                    <li
                      key={`${passage.documentId}-${index}`}
                      className="rounded-lg border border-line bg-surface-muted/40 p-3"
                    >
                      <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-muted">
                        {passage.text}
                      </blockquote>
                      <p className="mt-2 flex flex-wrap items-center gap-1.5 pl-3 text-[12px] text-ink-subtle">
                        <FileIcon className="size-3.5" />
                        <span className="font-medium text-ink-muted">
                          {passage.documentName ?? d.search.sourceDocument}
                        </span>
                        {passage.page !== null ? (
                          <span>
                            · {d.common.page} {passage.page}
                          </span>
                        ) : null}
                        {passage.section ? (
                          <span>· {passage.section}</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        {d.search.orderingNote}
      </p>
    </>
  );
}

/** Suspense fallback while retrieval is in flight. */
export function EvidenceResultsSkeleton() {
  const { d } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <p role="status" aria-live="polite" className="text-[12.5px] text-ink-muted">
        {d.search.searchingEvidence}
      </p>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
