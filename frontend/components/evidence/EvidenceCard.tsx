"use client";

import { CitationLink } from "@/components/evidence/CitationLink";
import { Badge } from "@/components/ui/Badge";
import { EvidenceStatusBadge } from "@/components/ui/StatusBadge";
import { AlertIcon } from "@/components/ui/icons";
import { REQUIREMENT_KIND_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { CandidateEvidence, Citation } from "@/lib/types";

interface EvidenceCardProps {
  evidence: CandidateEvidence;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
  className?: string;
}

export function EvidenceCard({
  evidence,
  onSelectCitation,
  activeCitationId,
  className,
}: EvidenceCardProps) {
  const missing = evidence.status === "not_found";

  return (
    <article
      className={cn(
        "rounded-xl border bg-surface p-3.5 shadow-card",
        missing ? "border-dashed border-line" : "border-line",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight text-ink">
            {evidence.requirementLabel}
          </h3>
          <Badge
            tone={evidence.requirementKind === "must_have" ? "brand" : "neutral"}
            className="mt-1"
          >
            {REQUIREMENT_KIND_LABELS[evidence.requirementKind]}
          </Badge>
        </div>
        <EvidenceStatusBadge status={evidence.status} />
      </div>

      {evidence.citations.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2.5">
          {evidence.citations.map((citation) => (
            <li key={citation.id}>
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
          Nothing in the uploaded documents supports this requirement. That is
          not a judgement about the candidate — ask about it in a screen.
        </p>
      )}

      {evidence.note ? (
        <p className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-2.5 py-2 text-[12.5px] leading-relaxed text-warning">
          <AlertIcon className="mt-px size-4 shrink-0" />
          <span>{evidence.note}</span>
        </p>
      ) : null}
    </article>
  );
}
