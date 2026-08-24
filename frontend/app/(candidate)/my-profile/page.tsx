import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { AccountProfileCard } from "@/components/account/AccountProfileCard";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { buttonStyles } from "@/components/ui/Button";
import { getTranslations } from "@/lib/i18n/server";
import { CandidatePageHeader } from "@/components/candidate/ui";
import { CandidateProfileWorkspace } from "@/components/candidate/CandidateProfileWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.candidateProfile.title };
}

/**
 * The job seeker's own profile.
 *
 * This is a `CandidateAccount` — the user's personal identity — and never the
 * recruiter-owned `Candidate` record that an organization keeps about the same
 * person. The two are separate by design and are never merged here.
 */
export default async function MyProfilePage() {
  // The session is the caller's ACCOUNT (name, sign-in address, picture) —
  // separate from the CandidateAccount below, which is the job-seeker profile.
  // Both are edited on this page; neither is the other.
  const { session } = await requirePersonalWorkspace();
  const [d, account] = await Promise.all([
    getTranslations(),
    // Null simply means the profile has not been created yet, which is the
    // normal starting state rather than an error.
    api.getCandidateAccount(),
  ]);
  // Both halves of the candidate's evidence, or the empty shapes when there is
  // no profile yet — the page renders the "create your profile" state then.
  const [documents, links] = account
    ? await Promise.all([api.getPersonalDocuments(), api.getCandidateLinks()])
    : [
        { documents: [], limit: 3, remaining: 3, primaryDocumentId: null },
        { links: [], limit: 3, remaining: 3 },
      ];

  return (
    <div className="mx-auto max-w-3xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionProfile}
        title={d.candidateProfile.title}
        description={d.candidateProfile.description}
      />
      {/*
        Account identity first: it is the one part of this page that exists
        before a job-seeker profile does, and the same component the recruiter
        settings screen uses.
      */}
      <Card className="mb-4">
        <CardHeader
          title={d.account.title}
          description={d.account.description}
        />
        <CardBody>
          <AccountProfileCard user={session} />
        </CardBody>
      </Card>

      {/*
        A pointer, not a second home for the data. The profile says who someone
        is and what they can demonstrate; what they WANT lives on its own page
        because it drives every job-search surface and changes independently.
      */}
      <Card className="mb-4">
        <CardHeader
          title={d.jobPreferences.title}
          description={d.jobPreferences.description}
          action={
            <Link
              href="/job-preferences"
              className={buttonStyles("secondary", "sm")}
            >
              {d.common.edit}
            </Link>
          }
        />
      </Card>

      <CandidateProfileWorkspace
        account={account}
        documents={documents}
        links={links}
      />
    </div>
  );
}
