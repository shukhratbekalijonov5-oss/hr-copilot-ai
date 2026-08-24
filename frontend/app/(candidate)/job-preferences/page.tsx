import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { CandidatePageHeader } from "@/components/candidate/ui";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonStyles } from "@/components/ui/Button";
import { UserIcon } from "@/components/ui/icons";
import { JobPreferencesForm } from "@/components/candidate/JobPreferencesForm";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobPreferences.title };
}

/**
 * What the candidate is looking for.
 *
 * A page of its own rather than a section of the profile: the profile says who
 * someone is and what they can demonstrate, and this says what they want —
 * different data with a different lifecycle, and the one that drives every job
 * search surface.
 */
export default async function JobPreferencesPage() {
  const { session } = await requirePersonalWorkspace();
  const { d } = await getI18n();

  // Preferences hang off the job-seeker profile, so there has to be one first.
  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-3xl">
        <CandidatePageHeader
          eyebrow={d.nav.sectionProfile}
          title={d.jobPreferences.title}
          description={d.jobPreferences.description}
        />
        <Card>
          <EmptyState
            icon={<UserIcon className="size-5" />}
            title={d.candidateProfile.title}
            description={d.candidateProfile.description}
            action={
              <Link
                href="/my-profile"
                className={buttonStyles("secondary", "sm")}
              >
                {d.candidateProfile.title}
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const preferences = await api.getJobPreferences();

  return (
    <div className="mx-auto max-w-3xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionProfile}
        title={d.jobPreferences.title}
        description={d.jobPreferences.description}
      />
      <JobPreferencesForm preferences={preferences} />
    </div>
  );
}
