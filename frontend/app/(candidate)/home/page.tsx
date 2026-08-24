import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getLocale, getTranslations } from "@/lib/i18n/server";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { buttonStyles } from "@/components/ui/Button";
import { CandidateAccountRequired } from "@/components/candidate/CandidateAccountRequired";
import { DashboardAiBanner } from "@/components/candidate/home/DashboardAiBanner";
import { DashboardAiEntries } from "@/components/candidate/home/DashboardAiEntries";
import { DashboardMatches } from "@/components/candidate/home/DashboardMatches";
import { DashboardPipeline } from "@/components/candidate/home/DashboardPipeline";
import { DashboardStats } from "@/components/candidate/home/DashboardStats";
import { DashboardReadiness } from "@/components/candidate/home/DashboardReadiness";
import {
  CandidateCardSkeleton,
  CandidateHero,
} from "@/components/candidate/ui";
import { SparkIcon, UploadIcon } from "@/components/ui/icons";
import { readinessSteps, applicationPipeline } from "@/lib/candidate/dashboard";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.home.title };
}

/**
 * The job seeker's home.
 *
 * ## Every number on this page came from the server
 *
 * There is no derived "career score", no projected outcome and no placeholder
 * row. Each panel reads one existing endpoint and, when that read fails, says
 * so in its own space instead of taking the page down with it — a dashboard
 * that 500s because one of five widgets is unavailable is worse than four
 * working widgets and one honest message.
 *
 * ## The expensive panel streams
 *
 * AI matching is a POST that can rank the whole catalogue, so it renders
 * inside `Suspense` behind a skeleton shaped like the real cards. The rest of
 * the page — which is four cheap reads — paints immediately rather than
 * waiting on it. That is also why the reads below run in one `Promise.all`.
 */
export default async function CandidateHomePage() {
  const [{ session, workspace }, d, locale] = await Promise.all([
    requirePersonalWorkspace(),
    getTranslations(),
    getLocale(),
  ]);

  if (!session.hasCandidateAccount) {
    return <CandidateAccountRequired />;
  }

  // `allSettled`: one unavailable panel must not blank the other four.
  const [account, evidence, applications, saved, preferences] =
    await Promise.allSettled([
      api.getCandidateAccount(),
      api.getCandidateEvidenceState(),
      api.getMyApplications(1, 5),
      api.getSavedJobs(1, 1),
      api.getJobPreferences(),
    ]);

  const value = <T,>(result: PromiseSettledResult<T>): T | null =>
    result.status === "fulfilled" ? result.value : null;

  const accountData = value(account);
  const evidenceData = value(evidence);
  const applicationsData = value(applications);
  const savedData = value(saved);
  const preferencesData = value(preferences);

  const firstName = session.fullName.split(" ")[0] || session.fullName;
  const steps = readinessSteps(
    { account: accountData, evidence: evidenceData, preferences: preferencesData },
    d,
  );
  const pipeline = applicationPipeline(applicationsData?.applications ?? []);

  return (
    <div className="ambient-hero mx-auto max-w-6xl">
      <CandidateHero
        eyebrow={d.nav.sectionHome}
        title={d.home.greeting.replace("{name}", firstName)}
        description={d.home.subtitle}
        action={
          <>
            <Link href="/job-matches" className={buttonStyles("primary", "md")}>
              <SparkIcon className="size-4" />
              {d.home.findMatchingJobs}
            </Link>
            <Link href="/my-profile" className={buttonStyles("secondary", "md")}>
              <UploadIcon className="size-4" />
              {d.home.updateResume}
            </Link>
          </>
        }
      />

      {/* The two paid doors, directly under the hero. */}
      <DashboardAiEntries entitlements={workspace.entitlements} />

      <div className="mt-3">
        <DashboardStats
        activeApplications={pipeline.active}
        savedJobs={savedData?.total ?? null}
        evidenceSources={evidenceData?.total ?? null}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {/*
            The one panel that can be slow, isolated so it cannot delay the
            rest. The fallback matches the real card geometry, so nothing
            below it jumps when the matches arrive.
          */}
          <Suspense
            fallback={
              <section>
                <div className="pb-3">
                  <div className="skeleton h-4 w-32 rounded-md" aria-hidden="true" />
                </div>
                <CandidateCardSkeleton rows={2} />
              </section>
            }
          >
            <DashboardMatches
              locale={locale}
              canUseInternalAiJobs={workspace.entitlements.canUseInternalAiJobs}
              canRunJobMatch={evidenceData?.canRunJobMatch ?? false}
            />
          </Suspense>

          <DashboardPipeline
            pipeline={pipeline}
            recent={applicationsData?.applications ?? []}
            failed={applications.status === "rejected"}
          />
        </div>

        <div className="min-w-0">
          <DashboardReadiness steps={steps} />
        </div>
      </div>

      <div className="mt-5">
        <DashboardAiBanner />
      </div>
    </div>
  );
}
