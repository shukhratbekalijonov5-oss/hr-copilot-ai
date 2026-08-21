import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api, ApiError } from "@/lib/api";
import { aiFailureReason } from "@/lib/api/ai-failure";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { CandidateWorkspace } from "@/components/candidates/CandidateWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  resolveVacancySelection,
  selectedVacancyId,
} from "@/lib/vacancy/selection";
import type {
  AiFailureReason,
  Candidate,
  EvidenceMap,
  MyVacancy,
} from "@/lib/types";

/** Reads the stored map, carrying a retrieval failure back as a value. */
async function readEvidenceMap(
  candidateId: string,
  vacancyId: string,
): Promise<{ map: EvidenceMap | null; failure: AiFailureReason | null }> {
  try {
    return { map: await api.getEvidenceMap(candidateId, vacancyId), failure: null };
  } catch (error) {
    return { map: null, failure: aiFailureReason(error, "retrieval") };
  }
}

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

/**
 * Candidate detail = candidate + active vacancy.
 *
 * The split the backend draws is drawn here too. Candidate-GLOBAL data
 * (profile, documents, applications) is read from `/candidates/:id` and is
 * stable across vacancy switches. Everything vacancy-DEPENDENT — the stage,
 * the JD evidence map, and the AI panels' context — hangs off the active
 * vacancy, which lives in `?vacancyId=` so it survives a refresh and can be
 * deep-linked.
 *
 * Because the selection is a search param, switching it re-runs this server
 * component: the evidence map below is re-read for the new pair and the
 * dependent panels remount. There is no client cache keyed by candidate alone
 * that could serve vacancy A's content under vacancy B.
 *
 * Which vacancies may be selected is the intersection of two real backend
 * facts — the candidate's own applications and the caller's own vacancies —
 * never a relationship invented here. That is exactly the set the backend
 * will accept: it requires the vacancy to be owned AND the candidate to be
 * associated with it.
 */
export default async function CandidateDetailPage(
  props: PageProps<"/candidates/[id]">,
) {
  const { workspace } = await requireOrganizationWorkspace();
  const d = await getTranslations();
  const [{ id }, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);

  let candidate: Candidate;
  let myVacancies: MyVacancy[];
  try {
    [candidate, myVacancies] = await Promise.all([
      api.getCandidate(id),
      api.getAllMyVacancies(),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.kind === "not_found") notFound();
    throw error;
  }

  // Vacancies this candidate is actually in AND the caller actually owns.
  const ownedById = new Map(myVacancies.map((vacancy) => [vacancy.id, vacancy]));
  const eligible = candidate.applications
    .map((application) => ownedById.get(application.vacancyId))
    .filter((vacancy): vacancy is MyVacancy => Boolean(vacancy));

  const requested = selectedVacancyId(searchParams);
  const { selected, invalid } = resolveVacancySelection(eligible, requested);

  /**
   * The CURRENT attempt in the active vacancy.
   *
   * A candidate may hold several applications to one vacancy — a rejection
   * ends an attempt without ending the relationship — so the newest is the
   * live one. Taking the first match would let an old rejected attempt show
   * as the candidate's stage.
   */
  const activeApplication =
    candidate.applications
      .filter((application) => application.vacancyId === selected?.id)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0] ?? null;

  /**
   * Read for the ACTIVE vacancy only. A plain read with no LLM in the path, so
   * the requirement table is present on first paint and still works while
   * generation is unavailable; when retrieval is down the reason travels into
   * the panel instead of failing the page.
   */
  const [evidence, conversations] = selected
    ? await Promise.all([
        readEvidenceMap(candidate.id, selected.id),
        // Creator-scoped: a colleague's vacancy yields nothing rather than
        // leaking that a conversation exists.
        api
          .getOrganizationConversations({
            vacancyId: selected.id,
            page: 1,
            limit: 100,
          })
          .catch(() => null),
      ])
    : [{ map: null, failure: null }, null];

  const evidenceMap = evidence.map;
  const evidenceMapFailure = evidence.failure;
  const conversationId =
    conversations?.conversations.find(
      (conversation) => conversation.candidate.id === candidate.id,
    )?.id ?? null;

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
        eligibleVacancies={eligible}
        activeVacancy={selected}
        invalidSelection={invalid}
        activeApplication={activeApplication}
        applicationConversationId={conversationId}
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
