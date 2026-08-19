"use client";

import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

interface UnavailableStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  /**
   * The specific backend capability this screen is waiting on. Naming it keeps
   * the gap visible in the product instead of only in a document.
   */
  requires?: string[];
  action?: ReactNode;
  className?: string;
}

/**
 * Shown where a screen exists but the backend cannot serve it yet.
 *
 * Deliberately not an error and not an empty list: both would suggest the
 * feature works and simply has no data. This says what is missing.
 */
export function UnavailableState({
  icon,
  title,
  description,
  requires,
  action,
  className,
}: UnavailableStateProps) {
  const { d } = useI18n();

  return (
    <Card className={cn("min-w-0", className)}>
      <CardBody className="flex flex-col items-start gap-4 py-8">
        {icon ? (
          <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-subtle">
            {icon}
          </span>
        ) : null}

        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-ink-muted">
            {description}
          </p>
        </div>

        {requires && requires.length > 0 ? (
          <div className="w-full rounded-lg border border-line bg-surface-muted/50 p-3.5">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
              {d.errors.waitingOn}
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-relaxed text-ink-muted">
              {requires.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {action}
      </CardBody>
    </Card>
  );
}
