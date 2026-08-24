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
import { ExternalApplicationsView } from "@/components/external/ExternalApplicationsView";
import { AiJobSearchTabs } from "@/components/candidate/AiJobSearchTabs";
import { JobUniverseNote } from "@/components/candidate/JobUniverseNote";
import { PlanLockedPage } from "@/components/plan/PlanLockedPage";
import { planUpgradeFrom } from "@/lib/entitlements/plan-error";
import { withCapabilityDenied } from "@/lib/entitlements/plan";
import {
  readPageParam,
  readStatusParam,
} from "@/lib/candidate/external-list-params";
import type { ExternalJobApplicationPage } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.externalApplications.title };
}

/**
 * The candidate's own record of applications made on employers' sites.
 *
 * ## Deliberately not `/my-applications`
 *
 * That page is the INTERNAL history: applications HR Copilot actually
 * received, whose stages are set by a recruiter and which this product can
 * report on truthfully. Nothing on this page is any of those things. Every row
 * here was typed in by the person reading it, about a process happening
 * somewhere this product cannot see.
 *
 * Merging the two would produce a single list where identical-looking rows
 * mean completely different things — some verified, some remembered — and no
 * way for a reader to tell which. So they are two routes, and this one says in
 * its own description who is keeping it.
 */
export default async function ExternalApplicationsPage(
  props: PageProps<"/external-jobs/applications">,
) {
  const { session, workspace } = await requirePersonalWorkspace();
  const [d, searchParams] = await Promise.all([
    getTranslations(),
    props.searchParams,
  ]);
  // Both validated: a hand-edited URL narrows the request rather than 400ing
  // the page for whoever the link was shared with.
  const requestedPage = readPageParam(searchParams);
  const status = readStatusParam(searchParams);

  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title={d.externalApplications.title}
          description={d.externalApplications.description}
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
   * Tracked external applications belong to the external product and carry its
   * plan requirement, gated before the read.
   *
   * What a downgrade does NOT do is erase them. These rows are the candidate's
   * own account of their job hunt, typed by them about processes happening
   * elsewhere; losing that because a subscription lapsed would be this product
   * destroying a person's records to make a point about billing.
   */
  if (!workspace.entitlements.canUseExternalAiJobs) {
    return (
      <PlanLockedPage
        capability="EXTERNAL_AI_SEARCH"
        entitlements={workspace.entitlements}
        current="external"
        title={d.externalApplications.title}
        description={d.externalApplications.description}
      />
    );
  }

  let page: ExternalJobApplicationPage | null = null;
  let failed = false;
  let upgradeRequired: ReturnType<typeof planUpgradeFrom> = null;
  try {
    page = await api.getExternalApplications(requestedPage, undefined, status);
  } catch (error) {
    upgradeRequired = planUpgradeFrom(error, "EXTERNAL_AI_SEARCH");
    failed = true;
  }

  // The backend's refusal outranks the session's optimism.
  if (upgradeRequired) {
    return (
      <PlanLockedPage
        capability="EXTERNAL_AI_SEARCH"
        entitlements={withCapabilityDenied(
          workspace.entitlements,
          "EXTERNAL_AI_SEARCH",
        )}
        current="external"
        title={d.externalApplications.title}
        description={d.externalApplications.description}
        requiredPlan={upgradeRequired.requiredPlan}
      />
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={d.externalApplications.title}
        description={d.externalApplications.description}
      />
      <AiJobSearchTabs current="external" entitlements={workspace.entitlements} />
      <JobUniverseNote universe="external" />
      <ExternalApplicationsView page={page} failed={failed} status={status} />
    </div>
  );
}
