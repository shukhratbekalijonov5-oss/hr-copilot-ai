import type { Metadata } from "next";
import { getTranslations } from "@/lib/i18n/server";
import { JobMatchesRoute } from "@/components/candidate/JobMatchesRoute";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.jobMatch.title };
}

/**
 * Candidate AI job match — the candidate-side counterpart of recruiter AI
 * search. The persistent candidate-layout provider owns the result so route
 * changes do not throw it away; the expensive matching call is still explicit.
 */
export default function JobMatchesPage() {
  return <JobMatchesRoute />;
}
