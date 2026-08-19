import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "positive"
  | "warning"
  | "critical"
  | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-neutral-soft text-ink-muted",
  brand: "bg-brand-soft text-brand-ink",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  info: "bg-info-soft text-info",
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
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap",
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
        "inline-flex items-center rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-[11.5px] text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
