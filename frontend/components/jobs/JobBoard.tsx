"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { JobCard } from "@/components/jobs/JobCard";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { BriefcaseIcon, MapPinIcon, SearchIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { PublicJobPage } from "@/lib/types";

interface JobBoardProps {
  page: PublicJobPage;
  savedSlugs: string[];
  search: string;
  location: string;
}

/**
 * The public job board.
 *
 * Search, location and paging live in the URL rather than component state, so a
 * result page can be shared and restored on back-navigation — and so the
 * filtering happens on the backend, which already supports both parameters.
 */
export function JobBoard({
  page,
  savedSlugs,
  search,
  location,
}: JobBoardProps) {
  const { d, p, f } = useI18n();
  const router = useRouter();
  const params = useSearchParams();

  const [searchValue, setSearchValue] = useState(search);
  const [locationValue, setLocationValue] = useState(location);

  const saved = new Set(savedSlugs);
  const filtered = Boolean(search || location);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams();
    if (searchValue.trim()) next.set("search", searchValue.trim());
    if (locationValue.trim()) next.set("location", locationValue.trim());
    const query = next.toString();
    router.push(query ? `/jobs?${query}` : "/jobs");
  }

  function clear() {
    setSearchValue("");
    setLocationValue("");
    router.push("/jobs");
  }

  function goToPage(next: number) {
    const query = new URLSearchParams(params.toString());
    query.set("page", String(next));
    router.push(`/jobs?${query}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody>
          <form
            onSubmit={submit}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <Input
              type="search"
              label={d.jobs.searchLabel}
              placeholder={d.jobs.searchPlaceholder}
              value={searchValue}
              leading={<SearchIcon className="size-4" />}
              onChange={(event) => setSearchValue(event.target.value)}
              wrapperClassName="sm:flex-1"
            />
            <Input
              type="search"
              label={d.jobs.locationLabel}
              placeholder={d.jobs.locationPlaceholder}
              value={locationValue}
              leading={<MapPinIcon className="size-4" />}
              onChange={(event) => setLocationValue(event.target.value)}
              wrapperClassName="sm:w-56"
            />
            <div className="flex gap-2">
              <Button type="submit" icon={<SearchIcon className="size-4" />}>
                {d.jobs.submit}
              </Button>
              {filtered ? (
                <Button type="button" variant="ghost" onClick={clear}>
                  {d.jobs.clear}
                </Button>
              ) : null}
            </div>
          </form>
        </CardBody>
      </Card>

      {page.jobs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BriefcaseIcon className="size-5" />}
            title={filtered ? d.jobs.noMatches : d.jobs.empty}
            description={filtered ? d.jobs.noMatchesHint : d.jobs.emptyHint}
          />
        </Card>
      ) : (
        <>
          <p className="text-[12.5px] text-ink-muted">
            {p(d.jobs.resultCount, page.total)}
          </p>

          <ul className="grid gap-3 md:grid-cols-2">
            {page.jobs.map((job) => (
              <li key={job.publicSlug} className="min-w-0">
                <JobCard job={job} saved={saved.has(job.publicSlug)} />
              </li>
            ))}
          </ul>

          {page.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page.page <= 1}
                onClick={() => goToPage(page.page - 1)}
              >
                {d.common.previous}
              </Button>
              <span className="text-[12.5px] tabular-nums text-ink-muted">
                {f(d.common.pageOf, {
                  page: page.page,
                  total: page.totalPages,
                })}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={page.page >= page.totalPages}
                onClick={() => goToPage(page.page + 1)}
              >
                {d.common.next}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
