"use client";

import { GlobeIcon, SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * Whose jobs these are, and what applying to them means.
 *
 * ## Source identity is a promise, not a label
 *
 * "HR Copilot Jobs" and "External Jobs" are not decoration on two similar
 * lists. They mean different things happen when the reader presses Apply: one
 * creates an application a recruiter in this product receives and can answer;
 * the other opens a stranger's website, after which this product knows nothing
 * until the candidate comes back and says so.
 *
 * That difference survives everywhere else in the UI — the Apply control, the
 * tracking control, the two separate applications lists — and this line is
 * where it is stated in words rather than left to be inferred from which page
 * you happen to be on.
 */
export function JobUniverseNote({
  universe,
}: {
  universe: "internal" | "external";
}) {
  const { d } = useI18n();
  const copy = d.aiJobSearch[universe];
  const Icon = universe === "internal" ? SparkIcon : GlobeIcon;

  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium text-ink">{copy.sourceName}</span>
      <span aria-hidden="true">·</span>
      <span>{copy.applyMeaning}</span>
    </p>
  );
}
