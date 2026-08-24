"use client";

import { CheckIcon, CloseIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { timelineFor, type TimelineNodeState } from "@/lib/candidate/timeline";
import type { ApplicationStatus } from "@/lib/types";

/**
 * Applied → Review → Interview → Decision, for ONE application.
 *
 * ## Every node's state comes from the stored status
 *
 * There is no per-stage history in the API — only the current status — so
 * the timeline shows what that status necessarily implies: an application at
 * Interview must have been submitted and reviewed. It never claims a date
 * for a stage the backend did not record, and it never invents a stage the
 * enum does not have.
 *
 * ## A rejection stops the line, it does not fill it
 *
 * A rejected application shows its reached stages as done and the decision
 * node as closed — drawn with a different glyph, not just a different
 * colour, and labelled in words underneath.
 */
export function ApplicationTimeline({ status }: { status: ApplicationStatus }) {
  const { d } = useI18n();
  const nodes = timelineFor(status);
  const copy = d.home.pipeline;

  const label: Record<string, string> = {
    applied: copy.applied,
    review: copy.review,
    interview: copy.interview,
    decision: copy.decision,
  };

  return (
    <ol className="flex items-start gap-0">
      {nodes.map((node, index) => (
        <li
          key={node.id}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-1.5",
            index === 0 && "items-start",
            index === nodes.length - 1 && "items-end",
          )}
        >
          <span className="flex w-full items-center gap-1">
            {/* Leading connector, drawn only between nodes. */}
            <span
              aria-hidden="true"
              className={cn(
                "h-px flex-1",
                index === 0 ? "bg-transparent" : connectorClass(node.state),
              )}
            />
            <Node state={node.state} />
            <span
              aria-hidden="true"
              className={cn(
                "h-px flex-1",
                index === nodes.length - 1
                  ? "bg-transparent"
                  : connectorClass(nodes[index + 1].state),
              )}
            />
          </span>
          <span
            className={cn(
              "max-w-full truncate text-[11.5px] leading-tight",
              node.state === "current"
                ? "font-semibold text-ink"
                : "text-ink-muted",
            )}
          >
            {label[node.id]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function connectorClass(state: TimelineNodeState): string {
  if (state === "done" || state === "current") return "bg-brand/40";
  if (state === "closed") return "bg-line-strong";
  return "bg-line";
}

/** The node glyph. Shape differs per state, never colour alone. */
function Node({ state }: { state: TimelineNodeState }) {
  if (state === "closed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-muted text-ink-muted">
        <CloseIcon className="size-2.5" aria-hidden="true" />
      </span>
    );
  }

  if (state === "done") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-brand/30 bg-brand-soft text-brand-ink">
        <CheckIcon className="size-2.5" aria-hidden="true" />
      </span>
    );
  }

  if (state === "current") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-surface">
        <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface"
      aria-hidden="true"
    >
      <span className="size-1 rounded-full bg-line-strong" />
    </span>
  );
}
