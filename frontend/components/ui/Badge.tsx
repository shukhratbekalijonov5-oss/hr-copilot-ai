import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "positive"
  | "warning"
  | "critical"
  | "info";

/*
 * Soft tint, darker semantic text, and a hairline border of the same hue.
 *
 * The border is what stops a pale pill from dissolving into a pale card —
 * the alternative is deepening the fill, which turns a status into a warning
 * light. `/60` on the border keeps it a suggestion of an edge rather than an
 * outline competing with the text.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-ink-muted border-line",
  brand: "bg-brand-soft text-brand-ink border-brand/20",
  positive: "bg-positive-soft text-positive border-positive/20",
  warning: "bg-warning-soft text-warning border-warning/20",
  critical: "bg-critical-soft text-critical border-critical/20",
  info: "bg-info-soft text-info border-info/20",
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Small neutral chip used for skills and keywords. */
export function Chip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-line bg-surface-muted px-2 py-0.5 text-[11.5px] text-ink-muted",
        "transition-colors duration-[var(--motion-fast)] hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
