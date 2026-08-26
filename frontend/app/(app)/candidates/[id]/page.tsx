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
import { vacancyAttempts } from "@/lib/vacancy/applicants";
import type { HrMatchInsight } from "@/lib/match/hr-insight";
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

/**
 * Reads the advanced assessment for the ACTIVE pair.
 *
 * Fetched on the server so the analysis is in the first paint rather than
 * behind a button: the endpoint is a sub-second deterministic read, and a
 * recruiter opening a candidate has already asked the only question it
 * answers. A failure travels back as a value so the rest of the page still
 * renders.
 */
async function readMatchInsight(
  candidateId: string,
  vacancyId: string,
): Promise<{ insight: HrMatchInsight | null; failure: AiFailureReason | null }> {
  try {
    return {
      insight: await api.getHrMatchInsight(candidateId, vacancyId),
      failure: null,
    };
  } catch (error) {
    return { insight: null, failure: aiFailureReason(error, "retrieval") };
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
  // Deduped by vacancy id: since reapply-after-rejection a candidate can hold
  // SEVERAL applications to one vacancy, but the selector offers the vacancy
  // relationship, not the attempts — the newest attempt is picked separately
  // below as `activeApplication`.
  const ownedById = new Map(myVacancies.map((vacancy) => [vacancy.id, vacancy]));
  const eligible = [
    ...new Map(
      candidate.applications
        .map((application) => ownedById.get(application.vacancyId))
        .filter((vacancy): vacancy is MyVacancy => Boolean(vacancy))
        .map((vacancy) => [vacancy.id, vacancy] as const),
    ).values(),
  ];

  const requested = selectedVacancyId(searchParams);
  const { selected, invalid } = resolveVacancySelection(eligible, requested);

  /**
   * This candidate's relationship with the ACTIVE vacancy: the current attempt
   * plus every earlier one.
   *
   * A candidate may hold several applications to one vacancy — a rejection
   * ends an attempt without ending the relationship — so the newest is the
   * live one, and the older ones are history rather than noise.
   *
   * Resolved by the SAME function the vacancy applicant list uses, so the two
   * screens can never disagree about which attempt is current.
   */
  const attempts = vacancyAttempts(candidate.applications, selected?.id ?? null);
  const activeApplication = attempts?.current ?? null;

  /**
   * Read for the ACTIVE vacancy only. A plain read with no LLM in the path, so
   * the requirement table is present on first paint and still works while
   * generation is unavailable; when retrieval is down the reason travels into
   * the panel instead of failing the page.
   */
  const [evidence, conversations, currentEvidence, matchInsight] = selected
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
        // The applicant's LIVE profile/evidence. Best-effort: a failure here
        // (a race with an account deletion, a transient error) hides the card
        // rather than failing the whole page.
        api
          .getCandidateCurrentEvidence(candidate.id, selected.id)
          .catch(() => null),
        readMatchInsight(candidate.id, selected.id),
      ])
    : [
        { map: null, failure: null },
        null,
        null,
        { insight: null, failure: null },
      ];

  const evidenceMap = evidence.map;
  const evidenceMapFailure = evidence.failure;
  const conversationId =
    conversations?.conversations.find(
      (conversation) => conversation.candidate.id === candidate.id,
    )?.id ?? null;

  return (
    <div className="ambient-hero mx-auto max-w-[90rem]">
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
        attempts={attempts?.attempts ?? []}
        applicationConversationId={conversationId}
        currentEvidence={currentEvidence}
        evidenceMap={evidenceMap}
        evidenceMapFailure={evidenceMapFailure}
        matchInsight={matchInsight.insight}
        matchInsightFailure={matchInsight.failure}
        role={
          workspace.active.kind === "organization"
            ? workspace.active.role
            : "INTERVIEWER"
        }
      />
    </div>
  );
}
