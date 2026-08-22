"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { LinkStatusBadge } from "@/components/ui/StatusBadge";
import { GlobeIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn, displayUrl } from "@/lib/utils";
import type { Citation, CurrentEvidenceLink } from "@/lib/types";

/**
 * The left pane for a URL evidence source — the applicant's CURRENT
 * professional link.
 *
 * There is no frozen submitted copy to show any more: the link is the
 * candidate's live one, its extracted content lives only in the evidence
 * index, and what a recruiter reads of it is the grounded citations. So this
 * pane shows the link's identity (title, URL, status), the passage behind the
 * active citation, and a way to open the original page — never a re-fetch,
 * never a raw content dump.
 */
export function CurrentLinkView({
  link,
  activeCitation,
  className,
}: {
  link: CurrentEvidenceLink | null;
  activeCitation: Citation | null;
  className?: string;
}) {
  const { d, date } = useI18n();

  if (!link) {
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
          {link.title ?? displayUrl(link.url, 40)}
        </span>
        <LinkStatusBadge status={link.status} />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">
            {d.candidates.originalUrl}
          </p>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-[13px] font-medium text-brand hover:underline"
          >
            {displayUrl(link.url, 60)}
          </a>
          {link.analysedAt ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              {date(link.analysedAt)}
            </p>
          ) : null}
        </div>

        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-[13px] font-medium text-brand hover:underline"
        >
          {d.candidates.openOriginal}
        </a>
      </div>

      {activeCitation && activeCitation.documentId === link.id ? (
        <div className="border-t border-line bg-brand-soft px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-ink">
            {d.candidates.showingCitation}
          </p>
          <p className="mt-1 line-clamp-6 text-[12.5px] leading-relaxed text-brand-ink">
            {activeCitation.snippet}
          </p>
        </div>
      ) : null}
    </div>
  );
}
