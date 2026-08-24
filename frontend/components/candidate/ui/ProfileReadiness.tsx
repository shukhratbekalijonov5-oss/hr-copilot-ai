import type { ReactNode } from "react";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * How ready this profile is to be matched against jobs.
 *
 * ## Every step is a fact the server already stated
 *
 * A step is `done` because a document exists, a link exists, preferences were
 * saved. Nothing here infers readiness, weights a step, or scores a person —
 * the percentage is simply completed ÷ total, so it can never disagree with
 * the list printed underneath it.
 *
 * ## Not a grade
 *
 * The wording is about what is still missing, not about how good somebody is.
 * A half-finished profile gets a next action, never a judgement.
 */
export interface ReadinessStep {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  done: boolean;
  href?: string;
  actionLabel?: ReactNode;
}

export function ProfileReadiness({
  steps,
  title,
  summary,
  completeLabel,
}: {
  steps: ReadinessStep[];
  title: ReactNode;
  /** e.g. "3 of 4 complete" — formatted and pluralized by the caller. */
  summary: ReactNode;
  /** Screen-reader wording for a finished step. */
  completeLabel: string;
}) {
  const done = steps.filter((step) => step.done).length;
  const percent = steps.length === 0 ? 0 : Math.round((done / steps.length) * 100);

  return (
    <section
      aria-label={typeof title === "string" ? title : undefined}
      className="rounded-[14px] border border-line bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </h2>
        <p className="text-[12.5px] tabular-nums text-ink-muted">{summary}</p>
      </div>

      {/*
        `role="img"` with the same sentence the text already says: the bar is a
        restatement, so a screen reader hears the count once, not twice.
      */}
      <div
        role="img"
        aria-label={typeof summary === "string" ? summary : undefined}
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <span
          className="block h-full rounded-full bg-brand transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-out)]"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="mt-3.5 flex flex-col divide-y divide-[var(--line)]">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                step.done
                  ? "border-positive/30 bg-positive-soft text-positive"
                  : "border-line bg-surface-muted text-ink-subtle",
              )}
            >
              {step.done ? (
                <>
                  <CheckIcon className="size-3" />
                  <span className="sr-only">{completeLabel}</span>
                </>
              ) : (
                <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[13.5px] font-medium",
                  step.done ? "text-ink-muted" : "text-ink",
                )}
              >
                {step.label}
              </span>
              {step.hint && !step.done ? (
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
                  {step.hint}
                </span>
              ) : null}
            </span>
            {!step.done && step.href ? (
              <a
                href={step.href}
                className="shrink-0 text-[12.5px] font-medium text-brand hover:text-brand-hover"
              >
                {step.actionLabel}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
