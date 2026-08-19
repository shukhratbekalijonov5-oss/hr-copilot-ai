"use client";

import { CitationLink } from "@/components/evidence/CitationLink";
import { Badge } from "@/components/ui/Badge";
import { EvidenceStatusBadge } from "@/components/ui/StatusBadge";
import { REQUIREMENT_PRIORITY_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Citation, RequirementEvidence } from "@/lib/types";

interface EvidenceCardProps {
  evidence: RequirementEvidence;
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
  const missing = evidence.status === "NOT_FOUND";

  return (
    <article
      className={cn(
        "min-w-0 rounded-xl border bg-surface p-3.5 shadow-card",
        missing ? "border-dashed border-line" : "border-line",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight text-ink">
            {evidence.requirementText}
          </h3>
          <Badge tone={evidence.required ? "brand" : "neutral"} className="mt-1">
            {evidence.required
              ? REQUIREMENT_PRIORITY_LABELS.required
              : REQUIREMENT_PRIORITY_LABELS.optional}
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
    </article>
  );
}
