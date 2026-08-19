import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { CandidateWorkspace } from "@/components/candidates/CandidateWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import type { Candidate, RequirementEvidence, Vacancy } from "@/lib/types";

export async function generateMetadata(
  props: PageProps<"/candidates/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const candidate = await api.getCandidate(id);
    return { title: candidate.fullName };
  } catch {
    return { title: "Candidate" };
  }
}

export default async function CandidateDetailPage(
  props: PageProps<"/candidates/[id]">,
) {
  await requireSession();
  const { id } = await props.params;

  let candidate: Candidate;
  try {
    candidate = await api.getCandidate(id);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  let vacancy: Vacancy | null = null;
  let evidence: RequirementEvidence[] = [];

  if (candidate.primaryVacancyId) {
    vacancy = await api.getVacancy(candidate.primaryVacancyId);
    evidence = await api.getCandidateRequirementEvidence(
      candidate.id,
      candidate.primaryVacancyId,
    );
  }

  return (
    <div className="mx-auto max-w-[90rem]">
      <PageHeader
        className="mb-4"
        breadcrumbs={[
          { label: "Candidates", href: "/candidates" },
          { label: candidate.fullName },
        ]}
        title={<span className="sr-only">{candidate.fullName}</span>}
      />
      <CandidateWorkspace
        candidate={candidate}
        vacancy={vacancy}
        evidence={evidence}
      />
    </div>
  );
}
