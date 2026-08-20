import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobMatchWorkspace } from "@/components/candidate/JobMatchWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobMatch.title };
}

/**
 * Candidate AI job match — the candidate-side counterpart of recruiter AI
 * search. The page itself only loads readiness (does a profile exist, is a
 * resume uploaded); the expensive matching call is user-initiated inside the
 * workspace so a mere visit or reload never runs Gemini.
 */
export default async function JobMatchesPage() {
  await requirePersonalWorkspace();
  const [d, account] = await Promise.all([
    getTranslations(),
    api.getCandidateAccount().catch(() => null),
  ]);

  // Mirrors the backend's own gate: matching needs a resume or profile signal.
  const hasProfileSignal = Boolean(
    account &&
      (account.skills.length > 0 ||
        account.experience.length > 0 ||
        account.headline ||
        account.summary),
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={d.jobMatch.title} description={d.jobMatch.description} />
      <JobMatchWorkspace
        hasAccount={account !== null}
        hasResume={Boolean(account?.resume)}
        hasProfileSignal={hasProfileSignal}
      />
    </div>
  );
}
