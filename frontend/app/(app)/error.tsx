"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { d } = useI18n();

  useEffect(() => {
    // Replace with the app's error reporter once one is configured.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <EmptyState
          icon={<AlertIcon className="size-5" />}
          title={d.errors.somethingWentWrong}
          description={d.errors.pageLoadFailed}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={reset}>
              {d.common.retry}
            </Button>
          }
        />
      </div>
    </div>
  );
}
