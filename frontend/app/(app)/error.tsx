"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertIcon } from "@/components/ui/icons";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with the app's error reporter once one is configured.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-line bg-surface shadow-card">
        <EmptyState
          icon={<AlertIcon className="size-5" />}
          title="Something went wrong"
          description="This page could not be loaded. Retrying usually fixes it."
          action={
            <Button type="button" variant="secondary" size="sm" onClick={reset}>
              Try again
            </Button>
          }
        />
      </div>
    </div>
  );
}
