import type { Metadata } from "next";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { UserIcon } from "@/components/ui/icons";
import { BACKEND_CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const { session } = await requirePersonalWorkspace();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="My profile"
        description="What recruiters see when you apply."
      />

      {!BACKEND_CAPABILITIES.candidateAccount ? (
        <UnavailableState
          icon={<UserIcon className="size-5" />}
          title="There is no job-seeker profile to edit yet"
          description={`You are signed in as ${session.email}, but that account only exists as a member of a recruiting organization. A job-seeker profile — headline, skills, experience, education, languages and a primary resume — has nowhere to be stored.`}
          requires={[
            "A CandidateAccount model owned by the user, separate from the recruiter-owned Candidate record",
            "Endpoints to read and update that profile as its owner",
            "A profile visibility setting, so a job seeker controls who can see them",
          ]}
        />
      ) : null}
    </div>
  );
}
