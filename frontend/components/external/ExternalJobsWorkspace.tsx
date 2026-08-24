"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ExternalJobCard } from "@/components/external/ExternalJobCard";
import { ExternalJobDetailDrawer } from "@/components/external/ExternalJobDetailDrawer";
import { ExternalJobFiltersBody } from "@/components/external/ExternalJobFilters";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import {
  AlertIcon,
  CloseIcon,
  FilterIcon,
  GlobeIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { useExternalPersonalState } from "@/lib/candidate/external-personal-state";
import { ExternalJobsTabs } from "@/components/external/ExternalJobsTabs";
import { cn } from "@/lib/utils";
import {
  EMPTY_EXTERNAL_PARAMS,
  activeFilterCount,
  externalPageCount,
  externalSearchHref,
  hasAnyFilter,
  type ExternalJobSearchParams,
} from "@/lib/candidate/external-job-filters";
import type {
  ExternalJobResult,
  ExternalJobSearchPage,
  ExternalJobSort,
} from "@/lib/types";

/**
 * The external job board.
 *
 * ## Why the search lives in the URL
 *
 * Every control here navigates. The page is rendered on the server from the
 * parameters in the address bar, which buys three things at once: a search can
 * be shared and bookmarked, the back button returns to the previous result set
 * instead of an empty form, and the ranking a reader sees is produced by the
 * same code path whether they arrived by typing, by paging, or by reloading.
 *
 * It also removes an entire class of bug. There is no client-side fetch to
 * race, so a fast third search cannot be overwritten by a slow first one — the
 * router supersedes the earlier navigation, and `isPending` describes only the
 * newest. (The one place a real race exists is the detail panel, which does
 * fetch; it carries its own guard.)
 *
 * ## Nothing here ranks
 *
 * The order is the backend's, arriving already sorted. This component does not
 * sort, score, filter or convert anything — it renders `page.results` in the
 * order given. There is deliberately no client-side "sort by newest": no
 * provider in this catalogue states when an employer published a role, and
 * sorting by the only date we have would rank employers by how recently our
 * own crawler happened to run.
 */
export function ExternalJobsWorkspace({
  page,
  params,
  failed,
}: {
  /** Null when the search could not be run at all. */
  page: ExternalJobSearchPage | null;
  /** The filters as they stand in the URL — the single source of truth. */
  params: ExternalJobSearchParams;
  failed: boolean;
}) {
  const { d, f, p } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /*
   * Saved and tracked state for every job on this screen, in ONE store shared
   * by the cards and the panel. Seeded from the server render; a mutation
   * writes it once and both surfaces re-read it, so the card behind an open
   * panel can never disagree with the panel in front of it.
   */
  const personal = useExternalPersonalState();

  const [form, setForm] = useState<ExternalJobSearchParams>(params);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openJob, setOpenJob] = useState<ExternalJobResult | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const patch = (changes: Partial<ExternalJobSearchParams>) =>
    setForm((current) => ({ ...current, ...changes }));

  const go = (href: string) => {
    // Inside a transition so React keeps the current results on screen while
    // the next page renders. Without it the list would blank on every search.
    startTransition(() => router.push(href));
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFiltersOpen(false);
    go(externalSearchHref(form));
  }

  function reset() {
    setForm(EMPTY_EXTERNAL_PARAMS);
    setFiltersOpen(false);
    // Only the controls on this page. Saved job preferences live in the
    // profile and are untouched — a reset here is "clear what I typed", not
    // "forget what I want".
    go("/external-jobs");
  }

  /**
   * Changing the sort navigates at once.
   *
   * Unlike the filters, which batch behind "Show results" because a reader
   * usually sets several, a sort is a single decision whose whole point is to
   * see the list again differently. Making them wait for a second click would
   * be ceremony.
   */
  function changeSort(next: ExternalJobSort) {
    if (next === params.sort) return;
    setForm((current) => ({ ...current, sort: next }));
    go(externalSearchHref(params, { sort: next }));
  }

  function goToPage(next: number) {
    go(externalSearchHref(params, { page: next }));
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const filterCount = activeFilterCount(form);
  const results = page?.results ?? [];
  /*
   * Relative ages measure from when the BACKEND produced this page, not from a
   * clock read here. Reading the clock during render is impure — it would give
   * the server pass and the hydration pass different answers across a midnight
   * boundary — and the response already carries the honest reference instant.
   */
  const now = page ? new Date(page.asOf).getTime() : 0;
  const pageCount = page ? externalPageCount(page.total, page.pageSize) : 0;
  const usingPreferences = page
    ? [
        page.applied.countries,
        page.applied.workModes,
        page.applied.employmentTypes,
        page.applied.seniorityLevels,
        page.applied.compensation,
      ].some((dimension) => dimension.source === "PREFERENCE")
    : false;

  return (
    <div className="flex flex-col gap-4">
      {/*
        Which board am I on. Two entries rather than one merged list, because
        the two answer differently: applying to an HR Copilot role happens
        here, applying to an external one happens on the employer's site, and a
        single list would have to hide that difference behind one button.
      */}
      <ExternalJobsTabs current="search" />

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Card>
          <CardBody className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Input
              type="search"
              label={d.externalJobs.searchLabel}
              placeholder={d.externalJobs.searchPlaceholder}
              value={form.search}
              leading={<SearchIcon className="size-4" />}
              onChange={(event) => patch({ search: event.target.value })}
              wrapperClassName="sm:flex-1"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                icon={<SearchIcon className="size-4" />}
                loading={pending}
              >
                {d.externalJobs.submit}
              </Button>
              {/* The drawer trigger, mobile and tablet only. */}
              <Button
                type="button"
                variant="secondary"
                icon={<FilterIcon className="size-4" />}
                onClick={() => setFiltersOpen(true)}
                className="lg:hidden"
                aria-expanded={filtersOpen}
              >
                {filterCount > 0
                  ? f(d.externalJobs.filtersWithCount, { count: filterCount })
                  : d.externalJobs.filters}
              </Button>
              {hasAnyFilter(params) ? (
                <Button type="button" variant="ghost" onClick={reset}>
                  {d.externalJobs.reset}
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Desktop: a quiet column. Mobile gets the sheet below instead. */}
          <aside className="hidden lg:block">
            <Card>
              <CardBody className="flex flex-col gap-4">
                <ExternalJobFiltersBody form={form} patch={patch} />
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  <Button type="submit" loading={pending}>
                    {d.externalJobs.applyFilters}
                  </Button>
                  <p className="text-[11.5px] leading-relaxed text-ink-subtle">
                    {d.externalJobs.resetHint}
                  </p>
                </div>
              </CardBody>
            </Card>
          </aside>

          <div ref={resultsRef} className="flex min-w-0 flex-col gap-3">
            {usingPreferences ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
                {/*
                  Said, but said quietly, and never expanded into a list of the
                  reader's own saved values — they know what they saved, and
                  reprinting a salary expectation on a shareable page is the
                  kind of leak nobody asks for.
                */}
                <span>{d.externalJobs.usingPreferences}</span>
                <Link
                  href="/job-preferences"
                  className="font-medium text-brand-ink hover:text-brand"
                >
                  {d.externalJobs.editPreferences}
                </Link>
              </p>
            ) : null}

            {results.length > 0 || pending ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  id="external-sort-label"
                  className="text-[12.5px] text-ink-muted"
                >
                  {d.externalJobs.sortLabel}
                </span>
                {/*
                  A radio group, not a dropdown: two options, and the current
                  one should be readable without opening anything. `aria-
                  pressed` carries the state rather than the brand tint alone.
                */}
                <div
                  role="group"
                  aria-labelledby="external-sort-label"
                  className="flex gap-1 rounded-lg border border-line bg-surface-muted p-0.5"
                >
                  {(
                    [
                      ["RELEVANCE", d.externalJobs.sortRelevance],
                      ["NEWEST", d.externalJobs.sortNewest],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={params.sort === value}
                      onClick={() => changeSort(value)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                        params.sort === value
                          ? "bg-surface text-ink shadow-card"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/*
                  Said explicitly when Newest is active: the order comes from
                  the employer's publication date, and the undated jobs are at
                  the end rather than missing. Without it a reader would have
                  to work out why some cards show no date at all.
                */}
                {params.sort === "NEWEST" ? (
                  <span className="text-[11.5px] text-ink-subtle">
                    {d.externalJobs.sortNewestNote}
                  </span>
                ) : null}
              </div>
            ) : null}

            {page?.degraded ? (
              /*
                Not an error page. Semantic retrieval is an accelerator: losing
                it costs recall, and the text index still answered. Saying so
                is more useful than either silence or a red banner.
              */
              <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-[12.5px] text-info">
                <AlertIcon className="mt-px size-4 shrink-0" />
                {d.externalJobs.degradedNotice}
              </p>
            ) : null}

            {failed ? (
              <Card>
                <EmptyState
                  icon={<AlertIcon className="size-5" />}
                  title={d.externalJobs.errorTitle}
                  description={d.externalJobs.errorHint}
                  action={
                    <Button
                      type="button"
                      onClick={() => startTransition(() => router.refresh())}
                      loading={pending}
                    >
                      {d.externalJobs.retry}
                    </Button>
                  }
                />
              </Card>
            ) : pending ? (
              <>
                <p role="status" className="text-[12.5px] text-ink-muted">
                  {d.externalJobs.searching}
                  <span className="ml-2 text-ink-subtle">
                    {d.externalJobs.searchingHint}
                  </span>
                </p>
                {/*
                  Skeletons rather than a spinner over the old results: the
                  first search after the embedding service has been idle can
                  take seconds, and a page that looks frozen invites a second
                  submit. Nothing here times out — a slow answer is still the
                  answer.
                */}
                <ul className="grid gap-3 xl:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <li key={index}>
                      <SkeletonCard />
                    </li>
                  ))}
                </ul>
              </>
            ) : results.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<GlobeIcon className="size-5" />}
                  title={
                    hasAnyFilter(params)
                      ? d.externalJobs.empty
                      : d.externalJobs.browseTitle
                  }
                  description={
                    hasAnyFilter(params) ? (
                      <>
                        <span className="block">{d.externalJobs.emptyHint}</span>
                        {/*
                          Suggestions the reader performs, never something this
                          page does for them. Silently widening a search they
                          narrowed would answer a question they did not ask.
                        */}
                        <span className="mt-1 block text-ink-subtle">
                          {d.externalJobs.emptyFewerWords}
                          {params.countries.length > 0
                            ? ` · ${d.externalJobs.emptyClearCountry}`
                            : ""}
                        </span>
                      </>
                    ) : (
                      d.externalJobs.browseHint
                    )
                  }
                  action={
                    hasAnyFilter(params) ? (
                      <Button type="button" variant="secondary" onClick={reset}>
                        {d.externalJobs.emptyClearAll}
                      </Button>
                    ) : null
                  }
                />
              </Card>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  {/*
                    `matched` — how many jobs answer the filters — and never
                    `total`, which is how many this snapshot ranked. They
                    legitimately differ, and the reader asked the first
                    question.
                  */}
                  <p className="text-[12.5px] text-ink-muted">
                    {p(d.externalJobs.resultCount, page?.matched ?? 0)}
                  </p>
                  {page?.truncated ? (
                    <p className="text-[12px] text-ink-subtle">
                      {d.externalJobs.truncatedNote}
                    </p>
                  ) : null}
                </div>

                <ul className="grid gap-3 xl:grid-cols-2">
                  {results.map((job) => (
                    <li key={job.externalJobId} className="min-w-0">
                      <ExternalJobCard
                        job={job}
                        onOpen={setOpenJob}
                        now={now}
                        personal={personal}
                      />
                    </li>
                  ))}
                </ul>

                {pageCount > 1 && page ? (
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
                        total: pageCount,
                      })}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={page.page >= pageCount}
                      onClick={() => goToPage(page.page + 1)}
                    >
                      {d.common.next}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Mobile and tablet: a sheet, so filters never eat the results. */}
        {filtersOpen ? (
          <div className="fixed inset-0 z-40 flex items-end lg:hidden">
            <button
              type="button"
              aria-label={d.externalJobs.close}
              onClick={() => setFiltersOpen(false)}
              className="absolute inset-0 bg-ink/25"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={d.externalJobs.filtersTitle}
              className="relative flex max-h-[85vh] w-full flex-col rounded-t-xl border-t border-line bg-surface"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold text-ink">
                  {d.externalJobs.filtersTitle}
                </h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label={d.externalJobs.close}
                  className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  <CloseIcon className="size-4.5" />
                </button>
              </div>
              <div className="overflow-y-auto px-4 py-4">
                <ExternalJobFiltersBody form={form} patch={patch} />
              </div>
              <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
                <Button type="submit" loading={pending}>
                  {d.externalJobs.applyFilters}
                </Button>
                <button
                  type="button"
                  onClick={reset}
                  className={cn(buttonStyles("ghost", "md"), "w-full")}
                >
                  {d.externalJobs.reset}
                </button>
                <p className="text-[11.5px] leading-relaxed text-ink-subtle">
                  {d.externalJobs.resetHint}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </form>

      <ExternalJobDetailDrawer
        job={openJob}
        onClose={() => setOpenJob(null)}
        now={now}
        personal={personal}
      />
    </div>
  );
}
