"use client";

import { CitationLink } from "@/components/evidence/CitationLink";
import { Badge, Chip } from "@/components/ui/Badge";
import { EvidenceStatusBadge } from "@/components/ui/StatusBadge";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { Citation, RequirementMapping } from "@/lib/types";

interface EvidenceCardProps {
  mapping: RequirementMapping;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
  className?: string;
}

/**
 * One job requirement and what the candidate's documents say about it.
 *
 * The card reports three things and nothing more: the status the backend
 * assigned, the passages behind it, and the terms it matched or did not find.
 * There is no per-requirement score and no aggregate — a requirement is either
 * supported by text a person can read, or it is not.
 */
export function EvidenceCard({
  mapping,
  onSelectCitation,
  activeCitationId,
  className,
}: EvidenceCardProps) {
  const { d } = useI18n();

  const unsupported =
    mapping.status === "NOT_FOUND" || mapping.status === "NOT_RUN";

  return (
    <article
      className={cn(
        "min-w-0 rounded-xl border bg-surface p-3.5 shadow-card",
        unsupported ? "border-dashed border-line" : "border-line",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight text-ink">
            {mapping.requirementText}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={mapping.required ? "brand" : "neutral"}>
              {mapping.required
                ? d.status.requirementPriority.required
                : d.status.requirementPriority.optional}
            </Badge>
            <Badge tone="neutral">
              {d.status.requirementType[mapping.requirementType]}
            </Badge>
          </div>
        </div>
        <EvidenceStatusBadge status={mapping.status} />
      </div>

      {mapping.citations.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {mapping.citations.map((citation) => (
            <li key={citation.id} className="min-w-0">
              <blockquote className="border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-muted">
                {citation.snippet}
              </blockquote>
              <div className="mt-1.5 pl-3">
                <CitationLink
                  citation={citation}
                  onSelect={onSelectCitation}
                  active={activeCitationId === citation.id}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
          {mapping.status === "NOT_RUN"
            ? d.ai.mapNotRunHint
            : d.evidence.nothingSupports}
        </p>
      )}

      {mapping.matchedTerms.length > 0 || mapping.missingTerms.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-2.5">
          {mapping.matchedTerms.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                {d.ai.mapMatchedTerms}
              </span>
              {mapping.matchedTerms.map((term) => (
                <Chip key={term}>{term}</Chip>
              ))}
            </p>
          ) : null}
          {mapping.missingTerms.length > 0 ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                {d.ai.mapMissingTerms}
              </span>
              {mapping.missingTerms.map((term) => (
                <Chip key={term}>{term}</Chip>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}

      {mapping.reason ? (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-subtle">
          <span className="font-semibold">{d.ai.mapReason}: </span>
          {mapping.reason}
        </p>
      ) : null}
    </article>
  );
}
