import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CandidatePageHeader } from "@/components/candidate/ui";
import { UserIcon } from "@/components/ui/icons";
import { SavedExternalJobsView } from "@/components/external/SavedExternalJobsView";
import { AiJobSearchTabs } from "@/components/candidate/AiJobSearchTabs";
import { JobUniverseNote } from "@/components/candidate/JobUniverseNote";
import { PlanLockedPage } from "@/components/plan/PlanLockedPage";
import { planUpgradeFrom } from "@/lib/entitlements/plan-error";
import { withCapabilityDenied } from "@/lib/entitlements/plan";
import { readPageParam } from "@/lib/candidate/external-list-params";
import type { SavedExternalJobPage } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.externalJobs.savedTitle };
}

/**
 * External jobs this candidate kept.
 *
 * ## Its own route, not a tab inside the search
 *
 * The search page's whole design is that its state lives in the URL. Hanging a
 * saved list off a query parameter on that same route would mean one page with
 * two unrelated states, and a "saved" view that quietly carries somebody's
 * search filters. A separate route renders on the server, is shareable, and
 * costs nothing to reason about.
 *
 * ## Separate from `/saved-jobs`
 *
 * That one is the INTERNAL saved list: those jobs are applied to here, inside
 * HR Copilot, and produce an application a recruiter sees. These are applied
 * to on an employer's own site and produce nothing this product can observe.
 * Merging them would put one Apply button over two different promises.
 *
 * ## A failed read is a state, not a crash
 *
 * Same rule as the search: nothing was computed and nothing is stale, so the
 * honest screen is a retry.
 */
export default async function SavedExternalJobsPage(
  props: PageProps<"/external-jobs/saved">,
) {
  const { session, workspace } = await requirePersonalWorkspace();
  const [d, searchParams] = await Promise.all([
    getTranslations(),
    props.searchParams,
  ]);
  // A URL is user input: a hand-edited `?page=` must narrow the request, not
  // 400 the page for whoever was sent the link.
  const requestedPage = readPageParam(searchParams);

  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-5xl">
        <CandidatePageHeader
          eyebrow={d.nav.sectionAiJobSearch}
          title={d.externalJobs.savedTitle}
          description={d.externalJobs.savedDescription}
        />
        <Card>
          <EmptyState
            icon={<UserIcon className="size-5" />}
            title={d.externalJobs.needsAccountTitle}
            description={d.externalJobs.needsAccountHint}
            action={
              <Link href="/my-profile" className={buttonStyles("primary", "md")}>
                {d.externalJobs.goToProfile}
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  /*
   * Saved external jobs are part of the external product, so they carry the
   * same plan requirement as the search that produced them — and the gate runs
   * before the read, so a locked reader's bookmarks are never fetched.
   *
   * The rows themselves are not deleted by a downgrade. They are the reader's
   * own data, and a plan lapsing is not consent to discard it.
   */
  if (!workspace.entitlements.canUseExternalAiJobs) {
    return (
      <PlanLockedPage
        capability="EXTERNAL_AI_SEARCH"
        entitlements={workspace.entitlements}
        current="external"
        title={d.externalJobs.savedTitle}
        description={d.externalJobs.savedDescription}
      />
    );
  }

  let page: SavedExternalJobPage | null = null;
  let failed = false;
  let upgradeRequired: ReturnType<typeof planUpgradeFrom> = null;
  try {
    page = await api.getSavedExternalJobs(requestedPage);
  } catch (error) {
    upgradeRequired = planUpgradeFrom(error, "EXTERNAL_AI_SEARCH");
    // Includes the window in which this API does not exist yet. Either way the
    // truthful screen is "could not load", never an empty list implying the
    // reader has saved nothing.
    failed = true;
  }

  // The backend refused on plan grounds even though the session said otherwise:
  // its answer wins, and the reader gets the paywall rather than a retry for a
  // request that will never succeed.
  if (upgradeRequired) {
    return (
      <PlanLockedPage
        capability="EXTERNAL_AI_SEARCH"
        entitlements={withCapabilityDenied(
          workspace.entitlements,
          "EXTERNAL_AI_SEARCH",
        )}
        current="external"
        title={d.externalJobs.savedTitle}
        description={d.externalJobs.savedDescription}
        requiredPlan={upgradeRequired.requiredPlan}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionAiJobSearch}
        title={d.externalJobs.savedTitle}
        description={d.externalJobs.savedDescription}
      />
      <AiJobSearchTabs current="external" entitlements={workspace.entitlements} />
      <JobUniverseNote universe="external" />
      <SavedExternalJobsView
        page={page}
        failed={failed}
        // The instant the SERVICE stamped when it read the list, so relative
        // ages cannot drift between the server pass and hydration.
        now={page ? new Date(page.asOf).getTime() : 0}
      />
    </div>
  );
}
