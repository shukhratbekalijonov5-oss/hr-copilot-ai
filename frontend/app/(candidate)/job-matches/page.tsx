import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { CandidatePageHeader } from "@/components/candidate/ui";
import { AiJobSearchTabs } from "@/components/candidate/AiJobSearchTabs";
import { JobUniverseNote } from "@/components/candidate/JobUniverseNote";
import { JobMatchWorkspace } from "@/components/candidate/JobMatchWorkspace";
import { PlanLockedPage } from "@/components/plan/PlanLockedPage";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobMatch.title };
}

/**
 * Internal AI job search — HR Copilot vacancies, ranked.
 *
 * ## The INTERNAL half of a deliberately split product
 *
 * Every job on this page is a vacancy published inside HR Copilot. Applying
 * happens here, the recruiter receives it, and the candidate can be told what
 * happened. Nothing from the external catalogue is ranked into this list, and
 * nothing here is ranked into the external one — the two calls hit different
 * backend endpoints over different tables and never meet.
 *
 * ## Gated before anything is fetched
 *
 * A reader without the plan gets the paywall instead of the workspace, and the
 * matching call is never made. That ordering is the point: fetching protected
 * results and then hiding them would spend a backend's expensive ranking pass
 * on output nobody is allowed to read, and would leave the answer sitting in a
 * server render one bug away from being shown.
 *
 * The lock rendered here is a display decision resolved from the session. The
 * enforcement is the backend's, on its own route, independently.
 */
export default async function JobMatchesPage() {
  const [{ workspace }, d] = await Promise.all([
    requirePersonalWorkspace(),
    getTranslations(),
  ]);

  if (!workspace.entitlements.canUseInternalAiJobs) {
    return (
      <PlanLockedPage
        capability="INTERNAL_AI_SEARCH"
        entitlements={workspace.entitlements}
        current="internal"
        title={d.jobMatch.title}
        description={d.jobMatch.description}
      />
    );
  }

  return (
    <div className="ambient-hero mx-auto max-w-4xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionAiJobSearch}
          title={d.jobMatch.title} description={d.jobMatch.description} />
      <AiJobSearchTabs current="internal" entitlements={workspace.entitlements} />
      <JobUniverseNote universe="internal" />
      <JobMatchWorkspace />
    </div>
  );
}
