import type { PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SparkIcon } from "@/components/ui/icons";

/**
 * The candidate visual system.
 *
 * One file because these pieces only make sense together: every candidate
 * page is built from this handful of shapes, and keeping them adjacent is what
 * stops a page from inventing its own heading size or its own card padding.
 * They are all server components — none of them holds state, so none of them
 * costs the browser anything.
 *
 * Deliberately NOT in `components/ui`: those are shared with the recruiting
 * side, where a denser, more table-like treatment is correct. A job seeker is
 * reading about their own career, not auditing a pipeline.
 */

/* ------------------------------------------------------------------ */
/* Page structure                                                      */
/* ------------------------------------------------------------------ */

/**
 * The top of every candidate page.
 *
 * `eyebrow` names the area (Career, Profile…), the h1 names the page, and
 * `action` carries the one thing a reader most likely came to do. The eyebrow
 * is what makes a page feel located inside a product rather than free-floating.
 */
export function CandidatePageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-3 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-brand-ink">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1.5 text-[25px] font-semibold leading-[1.15] tracking-[-0.025em] text-ink sm:text-[29px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

/**
 * The dashboard's opening block.
 *
 * Distinct from `CandidatePageHeader` because it earns decoration the other
 * pages do not: a soft accent panel, and one sparkle mark. That mark is the
 * only ornament in the candidate product, which is what keeps it feeling like
 * a signature rather than a texture.
 */
export function CandidateHero({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="accent-panel relative mb-5 overflow-hidden rounded-[16px] border border-line p-5 sm:p-6">
      {/* Decorative only, and hidden from assistive tech. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-8 hidden text-brand/15 sm:block"
      >
        <SparkIcon className="size-40" />
      </span>

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-brand-ink">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1.5 text-[26px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[32px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex shrink-0 flex-wrap gap-2">{action}</div>
        ) : null}
      </div>
    </header>
  );
}

/** A heading inside a page, optionally with a link or control on the right. */
export function SectionHeader({
  title,
  description,
  action,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-end justify-between gap-4 pb-3", className)}
    >
      <div className="min-w-0">
        <h2
          id={id}
          className="text-[15px] font-semibold tracking-[-0.01em] text-ink"
        >
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The candidate card surface: border-led, one restrained hover, 12px radius.
 * `interactive` is for cards that are themselves a link or button target.
 */
export function CandidateCard({
  interactive,
  className,
  children,
  onPointerMove,
}: {
  interactive?: boolean;
  className?: string;
  children: ReactNode;
  /** Supplied by `useSpotlight` on the few cards that carry one. */
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onPointerMove={onPointerMove}
      className={cn(
        "min-w-0 rounded-[14px] border border-line bg-surface",
        interactive && "card-interactive",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

/**
 * One metric. Tabular figures and a tight tracking so a row of these lines up
 * and reads as data — the single most "product" detail on a dashboard.
 *
 * `value` is a string so the caller formats it in the reader's locale; this
 * component never does arithmetic and never invents a number.
 */
export function CandidateStatCard({
  label,
  value,
  hint,
  icon,
  href,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-subtle">
          {label}
        </p>
        {icon ? <span className="text-ink-subtle">{icon}</span> : null}
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-ink">
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">{hint}</p>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="card-interactive block min-w-0 rounded-[14px] border border-line bg-surface p-4"
      >
        {body}
      </a>
    );
  }

  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface p-4">
      {body}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one surface every AI answer on the candidate side is rendered inside.
 *
 * A tinted panel with an accent hairline and a sparkle, used for nothing else.
 * That consistency is the point: "a model wrote this" has to be legible at a
 * glance, on every feature, without the page turning into a gradient.
 */
export function AiInsightPanel({
  title,
  status,
  actions,
  footer,
  className,
  children,
}: {
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        // `ai-edge` draws the fading accent hairline along the top. The tint
        // underneath stays very pale: the edge and the sparkle do the work of
        // marking this as generated, so the box never has to become purple.
        "ai-edge ai-halo overflow-hidden rounded-[14px] border border-ai-line bg-ai-tint",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ai-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ai-ink/10 text-ai-ink">
            <SparkIcon className="size-3.5" />
          </span>
          <h3 className="truncate text-[13px] font-semibold tracking-tight text-ai-ink">
            {title}
          </h3>
          {status ? <span className="shrink-0">{status}</span> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {actions}
          </div>
        ) : null}
      </div>
      <div className="max-w-[68ch] px-4 py-3.5 text-[13.5px] leading-[1.65] text-ink">
        {children}
      </div>
      {footer ? (
        <div className="border-t border-ai-line px-4 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Where one AI claim came from — a document, a link, a profile field.
 *
 * Provenance is a first-class part of the candidate AI surfaces: an unsourced
 * claim about somebody's own career is worth less than no claim at all.
 */
export function EvidenceChip({
  icon,
  children,
  title,
}: {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-ink-muted"
    >
      {icon ? <span className="shrink-0 text-ink-subtle">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/**
 * An empty list. Short sentence, one action, no illustration — a job seeker
 * with nothing saved yet needs a next step, not a cartoon.
 */
export function CandidateEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[14px] border border-line bg-elevated px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-1 flex size-9 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-subtle">
          {icon}
        </span>
      ) : null}
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * A failed read. Says what could not be loaded and offers the way back —
 * never the backend's own sentence, which is written for an operator.
 */
export function CandidateErrorState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[14px] border border-critical/25 bg-critical-soft px-4 py-3.5"
    >
      <p className="text-[13.5px] font-semibold text-critical">{title}</p>
      {description ? (
        <p className="text-[13px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** A skeleton block shaped like the thing it stands in for. */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden="true" />;
}

/**
 * A list of loading cards laid out exactly like the real ones, so content
 * arriving does not move the page. Announced once, politely.
 */
export function CandidateCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="rounded-[14px] border border-line bg-surface p-4"
          aria-hidden="true"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="h-3 w-1/3" />
            </div>
            <SkeletonBlock className="size-11 rounded-lg" />
          </div>
          <div className="mt-3 flex gap-1.5">
            <SkeletonBlock className="h-5 w-16" />
            <SkeletonBlock className="h-5 w-20" />
            <SkeletonBlock className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}
