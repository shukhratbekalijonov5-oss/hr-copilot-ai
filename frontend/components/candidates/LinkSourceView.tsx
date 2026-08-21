"use client";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentStatusBadge } from "@/components/ui/StatusBadge";
import { AlertIcon, ArrowRightIcon, GlobeIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn, displayUrl } from "@/lib/utils";
import type { CandidateLinkSource, Citation } from "@/lib/types";

/**
 * The recruiter's view of a submitted professional link.
 *
 * Deliberately NOT a rendering of the page. Two reasons, both deliberate:
 *
 *  - embedding an arbitrary third-party site in this app would execute
 *    somebody else's scripts inside a recruiter's authenticated session, and
 *    no product need here justifies that;
 *  - the page as it is TODAY is not what was submitted. This screen describes
 *    the snapshot — what was fetched, when, how much of it — and the evidence
 *    itself is read where it belongs: through grounded answers and citations,
 *    which quote the exact stored passages.
 *
 * The outbound link is offered plainly, with safe rel attributes, so a
 * recruiter who wants to look at the live site can — knowingly, in their own
 * tab, and aware that it may have changed since it was submitted.
 *
 * There are no mutation controls anywhere on this screen, and there is no API
 * behind one: a candidate's evidence is theirs.
 */
export function LinkSourceView({
  source,
  activeCitation,
  className,
}: {
  source: CandidateLinkSource | null;
  activeCitation: Citation | null;
  className?: string;
}) {
  const { d, f, p, date } = useI18n();

  if (!source) {
    return (
      <div
        className={cn(
          "min-w-0 rounded-xl border border-line bg-surface shadow-card",
          className,
        )}
      >
        <EmptyState
          icon={<GlobeIcon className="size-5" />}
          title={d.candidates.noSource}
          description={d.candidates.noSourceHint}
        />
      </div>
    );
  }

  const showingCitation =
    activeCitation?.sourceType === "URL" &&
    activeCitation.documentId === source.id;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <GlobeIcon className="size-4 shrink-0 text-ink-subtle" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {source.title}
        </span>
        <DocumentStatusBadge status={source.status} />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-[12px] text-ink-muted">
              {d.candidates.originalUrl}
            </dt>
            <dd className="min-w-0">
              {/*
                Elided for layout, full address in the tooltip and the href.
                noopener/noreferrer/nofollow: this is an untrusted destination a
                candidate supplied, so it gets no window handle, no referrer and
                no endorsement.
              */}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener nofollow"
                title={source.url}
                className="inline-flex max-w-full items-center gap-1.5 truncate text-[13.5px] font-medium text-brand hover:underline"
              >
                <span className="truncate">{displayUrl(source.url, 56)}</span>
                <ArrowRightIcon className="size-3.5 shrink-0" />
              </a>
            </dd>
          </div>

          <div>
            <dt className="text-[12px] text-ink-muted">
              {d.candidates.submittedContent}
            </dt>
            <dd className="text-[13.5px] text-ink">
              {f(d.candidates.fetchedOn, { date: date(source.fetchedAt) })}
              {source.pagesFetched
                ? ` · ${p(d.candidates.pagesRead, source.pagesFetched)}`
                : ""}
            </dd>
          </div>
        </dl>

        {/*
          Says plainly that the recruiter is looking at a frozen copy. Without
          this, a changed or deleted page would silently look like a system
          error rather than the expected, correct behaviour.
        */}
        <p className="rounded-lg bg-surface-muted/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          {d.candidates.snapshotNote}
        </p>

        {source.status === "FAILED" ? (
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-critical">
            <AlertIcon className="mt-px size-4 shrink-0" />
            {d.candidates.sourceIndexingFailed}
          </p>
        ) : null}

        {showingCitation ? (
          <div className="rounded-lg bg-brand-soft px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
              {d.candidates.showingCitation}
              {activeCitation.section ? ` · ${activeCitation.section}` : ""}
            </p>
            {/*
              Rendered as TEXT, never as markup: this content came from a page
              nobody here controls.
            */}
            <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-wrap text-brand-ink">
              {activeCitation.snippet}
            </p>
            {activeCitation.sourceUrl &&
            activeCitation.sourceUrl !== source.url ? (
              <a
                href={activeCitation.sourceUrl}
                target="_blank"
                rel="noreferrer noopener nofollow"
                title={activeCitation.sourceUrl}
                className="mt-2 block truncate text-[12px] font-medium text-brand-ink underline"
              >
                {displayUrl(activeCitation.sourceUrl, 44)}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t border-line px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            window.open(source.url, "_blank", "noopener,noreferrer")
          }
        >
          {d.candidates.openOriginal}
        </Button>
      </div>
    </div>
  );
}
