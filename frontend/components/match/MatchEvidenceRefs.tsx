"use client";

import { FileIcon, GlobeIcon, UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { displayUrl } from "@/lib/utils";
import type { MatchEvidenceRef } from "@/lib/match/insight";

/**
 * The citations behind ONE requirement row or transferable skill.
 *
 * A compact sibling of `MatchEvidenceList`, not a second design language: the
 * same provenance line (file · page · section, or the link), the same neutral
 * card, sized for sitting inside an expanded matrix row rather than standing
 * alone in a panel.
 *
 * ## Only evidence that supports THIS row appears
 *
 * The backend attaches refs per requirement, and this renders exactly those.
 * Padding the list with the match's other passages would make an unevidenced
 * requirement look supported — §"do not show irrelevant evidence filler".
 */
export function MatchEvidenceRefs({ refs }: { refs: MatchEvidenceRef[] }) {
  const { d, f } = useI18n();
  if (refs.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {refs.map((ref, index) => (
        <li
          key={index}
          className="rounded-lg border border-line bg-surface-muted/40 px-2.5 py-2"
        >
          <div className="flex items-center gap-1.5 text-[11px] text-ink-subtle">
            <SourceIcon kind={ref.sourceKind} />
            <span>{sourceLabel(ref, d)}</span>
            {ref.pageNumber !== null ? (
              <span>· {f(d.matchInsight.page, { page: ref.pageNumber })}</span>
            ) : null}
            {ref.section ? <span className="truncate">· {ref.section}</span> : null}
          </div>
          {ref.snippet ? (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
              {ref.snippet}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SourceIcon({ kind }: { kind: MatchEvidenceRef["sourceKind"] }) {
  // aria-hidden: the label beside it already names the source, so announcing
  // the glyph would read the same thing twice.
  if (kind === "URL") return <GlobeIcon className="size-3" aria-hidden />;
  if (kind === "PROFILE") return <UserIcon className="size-3" aria-hidden />;
  return <FileIcon className="size-3" aria-hidden />;
}

function sourceLabel(
  ref: MatchEvidenceRef,
  d: ReturnType<typeof useI18n>["d"],
): string {
  if (ref.sourceKind === "URL") {
    return ref.sourceUrl ? displayUrl(ref.sourceUrl) : d.matchInsight.sourceURL;
  }
  if (ref.sourceKind === "PROFILE") return d.matchInsight.sourcePROFILE;
  return ref.fileName ?? d.matchInsight.sourceFILE;
}
