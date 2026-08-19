"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { searchEvidenceAction } from "@/app/(app)/search/actions";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { AlertIcon, FileIcon, SearchIcon, SparkIcon } from "@/components/ui/icons";
import { pluralize } from "@/lib/utils";
import type { EvidenceSearchResult } from "@/lib/types";

const EXAMPLES = [
  "Production Kubernetes experience",
  "Redis Pub/Sub for event fan-out",
  "Designed a GraphQL schema for internal services",
  "Led a migration from a monolith to services",
];

/**
 * Evidence search.
 *
 * Results are passages from indexed resumes, each shown with the document, page
 * and section it came from. Candidates are ordered by which had the strongest
 * matching passage — never scored, ranked by quality, or recommended.
 */
export function SearchWorkspace() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<EvidenceSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(value: string) {
    if (pending) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    setError(null);
    setUnavailable(false);

    startTransition(async () => {
      const response = await searchEvidenceAction(trimmed);
      if (response.ok) {
        setResult(response.result);
        return;
      }
      setResult(null);
      setError(response.message);
      setUnavailable(response.unavailable);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(query);
            }}
            className="flex flex-col gap-3"
          >
            <label htmlFor="evidence-search" className="sr-only">
              Search resume evidence
            </label>
            <textarea
              id="evidence-search"
              rows={3}
              value={query}
              disabled={pending}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  run(query);
                }
              }}
              placeholder="Describe what you are looking for — e.g. ran Kubernetes in production and owned the on-call rotation"
              className="min-h-24 w-full resize-none rounded-lg border border-line bg-surface px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-subtle disabled:opacity-60"
            />

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <p className="text-[12px] text-ink-subtle">
                Enter to search · Shift + Enter for a new line
              </p>
              <Button
                type="submit"
                loading={pending}
                icon={<SearchIcon className="size-4" />}
                className="sm:ml-auto"
              >
                Search
              </Button>
            </div>
          </form>

          {!result && !pending ? (
            <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    run(example);
                  }}
                  className="rounded-md border border-line bg-surface-muted px-2 py-1 text-[12px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {unavailable ? (
        <UnavailableState
          icon={<SparkIcon className="size-5" />}
          title="Search is temporarily unavailable"
          description="The retrieval service behind search is not reachable right now, so there are no results to show. This is not the same as finding nothing — try again shortly."
        />
      ) : null}

      {error && !unavailable ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {pending ? (
        <div className="flex flex-col gap-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}

      {!pending && result ? (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
            <span>
              <span className="font-semibold text-ink">
                {result.candidates.length}
              </span>{" "}
              {pluralize(result.candidates.length, "candidate")} with matching
              passages
            </span>
            {result.reranked ? <Badge tone="neutral">Reranked</Badge> : null}
            <span className="ml-auto tabular-nums text-ink-subtle">
              {result.totalConsidered} considered · {result.durationMs}ms
            </span>
          </div>

          {result.candidates.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchIcon className="size-5" />}
                title="No supporting passages found"
                description="Nothing in the indexed documents matches that description. Try different wording, or check that the resumes have finished processing."
              />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {result.candidates.map((candidate) => (
                <li key={candidate.candidateId}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Avatar name={candidate.candidateName} />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/candidates/${candidate.candidateId}`}
                          className="text-[15px] font-semibold tracking-tight text-ink hover:text-brand"
                        >
                          {candidate.candidateName}
                        </Link>
                        <p className="text-[12.5px] text-ink-muted">
                          {candidate.passages.length}{" "}
                          {pluralize(candidate.passages.length, "matching passage")}
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
                              {passage.documentName}
                            </span>
                            {passage.page !== null ? (
                              <span>· page {passage.page}</span>
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
            Candidates appear in the order of their strongest matching passage.
            That reflects how closely text matched your query — it is not a score
            of the person, and it is not a hiring recommendation.
          </p>
        </>
      ) : null}
    </div>
  );
}
