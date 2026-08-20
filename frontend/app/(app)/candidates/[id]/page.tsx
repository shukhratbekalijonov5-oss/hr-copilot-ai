import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiError } from "@/lib/api";
import { aiFailureReason } from "@/lib/api/ai-failure";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { CandidateWorkspace } from "@/components/candidates/CandidateWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import type {
  AiFailureReason,
  Candidate,
  EvidenceMap,
  Vacancy,
} from "@/lib/types";

export async function generateMetadata(
  props: PageProps<"/candidates/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const candidate = await api.getCandidate(id);
    return { title: candidate.fullName };
  } catch {
    const d = await getTranslations();
    return { title: d.tables.candidate };
  }
}

export default async function CandidateDetailPage(
  props: PageProps<"/candidates/[id]">,
) {
  const { workspace } = await requireOrganizationWorkspace();
  const d = await getTranslations();
  const { id } = await props.params;

  let candidate: Candidate;
  try {
    candidate = await api.getCandidate(id);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  let vacancy: Vacancy | null = null;
  let evidenceMap: EvidenceMap | null = null;
  let evidenceMapFailure: AiFailureReason | null = null;
  let applicationConversationId: string | null = null;

  if (candidate.primaryVacancyId) {
    const [candidateVacancy, conversationsPage] = await Promise.all([
      api.getVacancy(candidate.primaryVacancyId),
      api.getOrganizationConversations({
        vacancyId: candidate.primaryVacancyId,
        page: 1,
        limit: 100,
      }),
    ]);
    vacancy = candidateVacancy;
    applicationConversationId =
      conversationsPage.conversations.find(
        (conversation) => conversation.candidate.id === candidate.id,
      )?.id ?? null;

    /**
     * The stored map is read here so the requirement table is present on first
     * paint rather than after a client round-trip. This is a plain read with no
     * LLM in the path, so it still succeeds while generation is unavailable —
     * and when even retrieval is down, the reason is carried into the panel
     * instead of the whole page failing.
     */
    try {
      evidenceMap = await api.getEvidenceMap(
        candidate.id,
        candidate.primaryVacancyId,
      );
    } catch (error) {
      evidenceMapFailure = aiFailureReason(error, "retrieval");
    }
  }

  return (
    <div className="mx-auto max-w-[90rem]">
      <PageHeader
        className="mb-4"
        breadcrumbs={[
          { label: d.candidates.title, href: "/candidates" },
          { label: candidate.fullName },
        ]}
        title={<span className="sr-only">{candidate.fullName}</span>}
      />
      <CandidateWorkspace
        candidate={candidate}
        vacancy={vacancy}
        applicationConversationId={applicationConversationId}
        evidenceMap={evidenceMap}
        evidenceMapFailure={evidenceMapFailure}
        role={
          workspace.active.kind === "organization"
            ? workspace.active.role
            : "INTERVIEWER"
        }
      />
    </div>
  );
}
