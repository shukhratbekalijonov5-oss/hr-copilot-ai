import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: "brand" | "positive" | "critical";
  className?: string;
  label?: string;
}

const TONES = {
  brand: "bg-brand",
  positive: "bg-positive",
  critical: "bg-critical",
} as const;

export function ProgressBar({
  value,
  max = 100,
  tone = "brand",
  className,
  label,
}: ProgressBarProps) {
  const percent = max === 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-muted",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", TONES[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
