import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  className,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
        {icon ? <span className="text-ink-subtle">{icon}</span> : null}
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-muted">{hint}</p>
      ) : null}
    </>
  );

  const classes = cn(
    "block rounded-xl border border-line bg-surface p-4 shadow-card",
    href && "transition-colors hover:border-line-strong hover:bg-surface-muted/50",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}
