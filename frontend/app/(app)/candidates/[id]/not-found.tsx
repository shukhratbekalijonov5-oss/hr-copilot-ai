import { NotFoundState } from "@/components/ui/NotFoundState";
import { getTranslations } from "@/lib/i18n/server";

export default async function CandidateNotFound() {
  const d = await getTranslations();

  return (
    <NotFoundState
      title={d.candidates.notFound}
      description={d.vacancyDetail.candidateRemovedOrWrongLink}
      backHref="/candidates"
      backLabel={d.candidates.backToCandidates}
    />
  );
}
