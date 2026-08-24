import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { UserIcon } from "@/components/ui/icons";
import { ExternalJobsWorkspace } from "@/components/external/ExternalJobsWorkspace";
import { AiJobSearchTabs } from "@/components/candidate/AiJobSearchTabs";
import { JobUniverseNote } from "@/components/candidate/JobUniverseNote";
import { PlanLockedPage } from "@/components/plan/PlanLockedPage";
import { planUpgradeFrom } from "@/lib/entitlements/plan-error";
import { withCapabilityDenied } from "@/lib/entitlements/plan";
import {
  readExternalSearchParams,
  toExternalSearchRequest,
} from "@/lib/candidate/external-job-filters";
import type { ExternalJobSearchPage } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.externalJobs.title };
}

/**
 * Roles published outside HR Copilot.
 *
 * ## Rendered on the server, from the URL
 *
 * The search runs here, during the render, from parameters read out of the
 * address bar. That is what makes a result page shareable and restorable — and
 * what keeps the client free of any ranking logic, because the client never
 * sees anything but an ordered list.
 *
 * ## Every parameter is validated first
 *
 * A URL is user input. `readExternalSearchParams` drops unknown enum values,
 * non-ISO country codes, negative pages and over-long queries, so a
 * hand-edited address produces a narrower search rather than a 400 from the
 * API — a job search that answers with an error page because someone shared a
 * mangled link is a broken product, not a caught attack.
 *
 * ## A failed search is a state, not a crash
 *
 * The API being unreachable renders a retry, not an error boundary. Nothing
 * was computed, nothing is stale, and the honest thing to say is "try again".
 */
export default async function ExternalJobsPage(
  props: PageProps<"/external-jobs">,
) {
  const { session, workspace } = await requirePersonalWorkspace();
  const [d, searchParams] = await Promise.all([
    getTranslations(),
    props.searchParams,
  ]);

  const params = readExternalSearchParams(searchParams);

  /*
   * The backend resolves this candidate's saved preferences per request and
   * ranks with them. Without an account there is nothing to resolve and the
   * endpoint refuses — so the invitation to create one is the honest screen,
   * not an empty result list implying the catalogue is bare.
   */
  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={d.externalJobs.title}
          description={d.externalJobs.description}
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
   * The plan gate comes BEFORE the search, not after it.
   *
   * A locked reader never causes a ranking pass over the external catalogue:
   * no query is built, no request leaves this server, and there is no result
   * sitting in the render waiting for a bug to reveal it. "Fetch and hide" is
   * the pattern this ordering exists to refuse.
   */
  if (!workspace.entitlements.canUseExternalAiJobs) {
    return (
      <PlanLockedPage
        capability="EXTERNAL_AI_SEARCH"
        entitlements={workspace.entitlements}
        current="external"
        title={d.externalJobs.title}
        description={d.externalJobs.description}
      />
    );
  }

  let page: ExternalJobSearchPage | null = null;
  let failed = false;
  try {
    page = await api.searchExternalJobs(toExternalSearchRequest(params));
  } catch (error) {
    /*
     * The backend has the last word, and it can differ from what the session
     * said — a plan that lapsed a minute ago, a downgrade made in another tab,
     * a build whose entitlement data is older than the account. Its refusal
     * becomes the same paywall the gate above would have shown, rather than
     * "Something went wrong", which would be both wrong and unactionable.
     */
    const upgrade = planUpgradeFrom(error, "EXTERNAL_AI_SEARCH");
    if (upgrade) {
      return (
        <PlanLockedPage
          capability="EXTERNAL_AI_SEARCH"
          entitlements={withCapabilityDenied(
            workspace.entitlements,
            "EXTERNAL_AI_SEARCH",
          )}
          current="external"
          title={d.externalJobs.title}
          description={d.externalJobs.description}
          requiredPlan={upgrade.requiredPlan}
        />
      );
    }
    failed = true;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={d.externalJobs.title}
        description={d.externalJobs.description}
      />
      <AiJobSearchTabs current="external" entitlements={workspace.entitlements} />
      <JobUniverseNote universe="external" />
      <ExternalJobsWorkspace
        page={page}
        params={params}
        failed={failed}
      />
    </div>
  );
}
