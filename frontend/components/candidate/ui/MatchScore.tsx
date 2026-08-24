import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * How well one job matches — shown compactly, and never inflated.
 *
 * ## A ring, not a dashboard gauge
 *
 * The score is one number among many things on a card, so it renders at 44px
 * as a thin ring with the figure inside. A large coloured dial would make the
 * number look more precise than it is: these scores come from evidence
 * coverage, not from a probability that anyone gets hired.
 *
 * ## The band is words, the ring is decoration
 *
 * `band` is the backend's own classification and is always rendered as text.
 * Colour never carries the meaning alone — a reader who cannot distinguish the
 * hues still reads "Strong match". When no score exists, the band alone shows;
 * an absent number is never drawn as zero.
 */
export type ScoreBand = "strong" | "good" | "partial" | "unknown";

const BAND_STYLES: Record<ScoreBand, { ring: string; chip: string }> = {
  strong: {
    ring: "text-positive",
    chip: "border-positive/30 bg-positive-soft text-positive",
  },
  good: {
    ring: "text-brand",
    chip: "border-brand/25 bg-brand-soft text-brand-ink",
  },
  partial: {
    ring: "text-warning",
    chip: "border-warning/30 bg-warning-soft text-warning",
  },
  unknown: {
    ring: "text-ink-subtle",
    chip: "border-line bg-surface-muted text-ink-muted",
  },
};

/** The ring. `percent` is 0–100 and must already be rounded by the caller. */
export function MatchScoreRing({
  percent,
  band,
  label,
  size = 44,
}: {
  percent: number;
  band: ScoreBand;
  /** Accessible sentence, e.g. "Strong match, 87 percent". Localized. */
  label: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;

  return (
    <span
      role="img"
      aria-label={label}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-line"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
          className={BAND_STYLES[band].ring}
        />
      </svg>
      <span className="absolute text-[12px] font-semibold tabular-nums leading-none text-ink">
        {clamped}
      </span>
    </span>
  );
}

/** The band, as a word. This is the part that actually communicates. */
export function MatchBandChip({
  band,
  children,
  className,
}: {
  band: ScoreBand;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap",
        BAND_STYLES[band].chip,
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A thin horizontal alternative for dense lists, where a ring per row would
 * be visual noise. Same rule: the number is optional, the band is not.
 */
export function MatchScoreBar({
  percent,
  band,
  label,
}: {
  percent: number;
  band: ScoreBand;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span
        role="img"
        aria-label={label}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-line"
      >
        <span
          className={cn("block h-full rounded-full bg-current", BAND_STYLES[band].ring)}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="text-[12px] font-semibold tabular-nums text-ink">
        {clamped}
      </span>
    </span>
  );
}
