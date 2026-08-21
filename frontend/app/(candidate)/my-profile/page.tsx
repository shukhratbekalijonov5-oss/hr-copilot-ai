import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
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
  await requirePersonalWorkspace();
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
      <PageHeader
        title={d.candidateProfile.title}
        description={d.candidateProfile.description}
      />
      <CandidateProfileWorkspace
        account={account}
        documents={documents}
        links={links}
      />
    </div>
  );
}
