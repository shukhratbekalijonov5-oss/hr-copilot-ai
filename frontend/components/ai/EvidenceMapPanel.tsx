"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  readEvidenceMapAction,
  runEvidenceMapAction,
} from "@/app/(app)/candidates/[id]/actions";
import { AiFailureNotice } from "@/components/ai/AiFailureNotice";
import { EvidenceCard } from "@/components/evidence/EvidenceCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/LoadingSkeleton";
import { CompareIcon, RefreshIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type {
  AiFailureReason,
  Citation,
  EvidenceMap,
  Role,
} from "@/lib/types";

interface EvidenceMapPanelProps {
  candidateId: string;
  vacancyId: string;
  vacancyTitle: string;
  /**
   * Server-rendered stored map, so the panel is populated on first paint.
   *
   * Null when the page did not read this pair — switching to another of the
   * candidate's vacancies, for instance — in which case the panel reads it
   * itself on mount. That read is a plain database call, not a generation.
   */
  initialMap: EvidenceMap | null;
  /** Why the server-side read failed, if it did. */
  initialFailure: AiFailureReason | null;
  /** The viewer's role in this organization. */
  role: Role;
  onSelectCitation?: (citation: Citation) => void;
  activeCitationId?: string | null;
}

/**
 * Roles the backend lets run a mapping (`@Roles` on EvidenceMapController).
 *
 * Mirrored here only so an INTERVIEWER is told why rather than shown a button
 * that 403s. The backend remains the authorization boundary — hiding a control
 * never makes an action safe.
 */
const CAN_RUN_MAPPING: Role[] = ["OWNER", "HR_ADMIN", "RECRUITER"];

/**
 * The flagship view: every job requirement against the candidate's evidence.
 *
 * Deliberately absent: any overall fit score, percentage or ranking. Each
 * requirement stands alone with the passages behind it, and the judgement is
 * the recruiter's.
 */
export function EvidenceMapPanel({
  candidateId,
  vacancyId,
  vacancyTitle,
  initialMap,
  initialFailure,
  role,
  onSelectCitation,
  activeCitationId,
}: EvidenceMapPanelProps) {
  const { d, f, date } = useI18n();

  const [map, setMap] = useState<EvidenceMap | null>(initialMap);
  const [failure, setFailure] = useState<{
    reason: AiFailureReason;
    message?: string;
  } | null>(initialFailure ? { reason: initialFailure } : null);
  // `useTransition` is what makes a second click a no-op: the button is
  // disabled for the whole round trip, so a double click cannot start two runs.
  const [pending, startTransition] = useTransition();

  const canRun = CAN_RUN_MAPPING.includes(role);

  // Guards the mount read so React's development double-invoke, and any
  // re-render, cannot fire a second request for the same pair.
  const loadedRef = useRef(initialMap !== null || initialFailure !== null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    startTransition(async () => {
      const result = await readEvidenceMapAction(candidateId, vacancyId);
      if (result.ok) setMap(result.data);
      else setFailure({ reason: result.reason, message: result.message });
    });
  }, [candidateId, vacancyId]);

  function run(read = false) {
    if (pending) return;
    setFailure(null);

    startTransition(async () => {
      const result = read
        ? await readEvidenceMapAction(candidateId, vacancyId)
        : await runEvidenceMapAction(candidateId, vacancyId);

      if (result.ok) setMap(result.data);
      else setFailure({ reason: result.reason, message: result.message });
    });
  }

  const requirements = map?.requirements ?? [];
  const found = requirements.filter((item) => item.status === "FOUND").length;
  const hasRun = map?.hasRun ?? false;

  const runButton = canRun ? (
    <Button
      type="button"
      variant={hasRun ? "secondary" : "primary"}
      size="sm"
      loading={pending}
      disabled={pending}
      onClick={() => run(false)}
      icon={
        hasRun ? (
          <RefreshIcon className="size-4" />
        ) : (
          <SparkIcon className="size-4" />
        )
      }
    >
      {hasRun ? d.ai.mapRerun : d.ai.mapRun}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink-muted">
        {hasRun ? (
          <span>
            {f(d.ai.mapFoundCount, { found, total: requirements.length })}
          </span>
        ) : (
          <span>{d.ai.mapNotRun}</span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-ink-subtle">
            {f(d.ai.mapCheckedAgainst, { vacancy: vacancyTitle })}
          </span>
          {map?.mappedAt ? (
            <span className="text-ink-subtle">
              {f(d.ai.mapLastRun, { date: date(map.mappedAt) })}
            </span>
          ) : null}
          {runButton}
        </span>
      </div>

      {failure ? (
        <AiFailureNotice reason={failure.reason} message={failure.message} />
      ) : null}

      {pending ? (
        <>
          <p
            role="status"
            className="text-[12.5px] text-ink-muted"
            aria-live="polite"
          >
            {d.ai.mapRunning}
          </p>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : null}

      {!pending && requirements.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CompareIcon className="size-5" />}
            title={d.ai.mapNoRequirements}
            description={d.ai.mapNoRequirementsHint}
          />
        </Card>
      ) : null}

      {!pending && requirements.length > 0 && !hasRun && !canRun ? (
        <Card>
          <EmptyState
            icon={<SparkIcon className="size-5" />}
            title={d.ai.mapNotRun}
            description={d.ai.mapForbidden}
          />
        </Card>
      ) : null}

      {!pending
        ? requirements.map((mapping) => (
            <EvidenceCard
              key={mapping.requirementId}
              mapping={mapping}
              onSelectCitation={onSelectCitation}
              activeCitationId={activeCitationId}
            />
          ))
        : null}

      {requirements.length > 0 ? (
        <p className="text-[12px] leading-relaxed text-ink-subtle">
          {d.ai.noOverallScore}
        </p>
      ) : null}
    </div>
  );
}
