"use client";

import { UnavailableState } from "@/components/ui/UnavailableState";
import { AlertIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { AiFailureReason } from "@/lib/types";

/**
 * Why an AI call produced nothing.
 *
 * Each reason gets its own words. In particular a generation outage says that
 * evidence search still works, because that is true and it is the difference
 * between "the product is broken" and "one capability is briefly down".
 *
 * Provider names are never shown: which model sits behind generation is not the
 * recruiter's problem, and naming it in an error would leak an implementation
 * detail into a customer-facing screen.
 */
export function AiFailureNotice({
  reason,
  message,
  className,
}: {
  reason: AiFailureReason;
  /** Backend text, used only for reasons with no specific copy. */
  message?: string;
  className?: string;
}) {
  const { d } = useI18n();

  if (reason === "generation_unavailable") {
    return (
      <UnavailableState
        className={className}
        icon={<SparkIcon className="size-5" />}
        title={d.ai.generationUnavailable}
        description={d.ai.generationUnavailableHint}
      />
    );
  }

  if (reason === "retrieval_unavailable") {
    return (
      <UnavailableState
        className={className}
        icon={<SparkIcon className="size-5" />}
        title={d.ai.retrievalUnavailable}
        description={d.ai.retrievalUnavailableHint}
      />
    );
  }

  if (reason === "network") {
    return (
      <UnavailableState
        className={className}
        icon={<AlertIcon className="size-5" />}
        title={d.ai.networkFailed}
        description={d.ai.networkFailedHint}
      />
    );
  }

  const text =
    reason === "forbidden"
      ? d.ai.mapForbidden
      : reason === "not_found"
        ? d.errors.notFound
        : reason === "invalid"
          ? d.errors.validation
          : (message ?? d.errors.server);

  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical",
        className,
      )}
    >
      <AlertIcon className="mt-px size-4 shrink-0" />
      {text}
    </p>
  );
}
