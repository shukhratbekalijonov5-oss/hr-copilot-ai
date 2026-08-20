"use client";

import { JobMatchWorkspace } from "@/components/candidate/JobMatchWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { useI18n } from "@/lib/i18n/context";

export function JobMatchesRoute() {
  const { d } = useI18n();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={d.jobMatch.title} description={d.jobMatch.description} />
      <JobMatchWorkspace />
    </div>
  );
}
