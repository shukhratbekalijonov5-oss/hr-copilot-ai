import { mockRequest } from "@/lib/api/client";
import { candidates, passagesFor, vacancies } from "@/lib/mock/store";
import type {
  SearchMatch,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "@/lib/types";

/**
 * The vocabulary the mock can recognise: every requirement label across all
 * vacancies plus every skill listed on a candidate. The real search endpoint
 * will do this server-side against the embedding index.
 */
const VOCABULARY: string[] = [
  ...new Set([
    ...vacancies.flatMap((vacancy) =>
      vacancy.requirements.map((requirement) => requirement.label),
    ),
    ...candidates.flatMap((candidate) => candidate.skills),
  ]),
];

/** Common shorthand a recruiter is likely to type. */
const ALIASES: Record<string, string> = {
  k8s: "Kubernetes",
  kube: "Kubernetes",
  nest: "NestJS",
  "nest js": "NestJS",
  "next js": "Next.js App Router",
  postgres: "PostgreSQL",
  psql: "PostgreSQL",
  ts: "TypeScript",
  a11y: "Accessibility (WCAG 2.2 AA)",
  pubsub: "Redis Pub/Sub",
  "pub sub": "Redis Pub/Sub",
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pulls known terms out of a free-text query. */
export function interpretQuery(query: string): string[] {
  const haystack = ` ${normalize(query)} `;
  const found = new Set<string>();

  for (const term of VOCABULARY) {
    if (haystack.includes(` ${normalize(term)} `) || haystack.includes(normalize(term))) {
      found.add(term);
    }
  }

  for (const [alias, term] of Object.entries(ALIASES)) {
    if (haystack.includes(` ${normalize(alias)} `)) {
      found.add(term);
    }
  }

  // Prefer the most specific term when one contains another, e.g. drop "Redis"
  // when "Redis Pub/Sub" already matched.
  const terms = [...found];
  return terms.filter(
    (term) =>
      !terms.some(
        (other) =>
          other !== term && normalize(other).includes(normalize(term)),
      ),
  );
}

export async function searchCandidates(
  input: SearchQuery,
): Promise<SearchResponse> {
  return mockRequest(() => {
    const startedAt = Date.now();
    const interpretedTerms = interpretQuery(input.query);
    const vacancyId = input.vacancyId ?? "all";

    const pool = candidates.filter((candidate) =>
      vacancyId === "all" ? true : candidate.primaryVacancyId === vacancyId,
    );

    const results: SearchResult[] = [];

    for (const candidate of pool) {
      const passages = passagesFor(candidate.id);
      const matches: SearchMatch[] = [];
      const matchedTerms = new Set<string>();

      for (const term of interpretedTerms) {
        const passage = passages.find(
          (item) => normalize(item.term) === normalize(term),
        );
        if (passage) {
          matches.push({ term, citation: passage.citation });
          matchedTerms.add(term);
        }
      }

      if (matches.length === 0) continue;

      results.push({
        candidateId: candidate.id,
        candidateName: candidate.fullName,
        currentTitle: candidate.currentTitle,
        location: candidate.location,
        yearsOfExperience: candidate.yearsOfExperience,
        relevantSkills: candidate.skills.filter((skill) =>
          interpretedTerms.some((term) => normalize(term).includes(normalize(skill))),
        ),
        matches,
        unmatchedTerms: interpretedTerms.filter((term) => !matchedTerms.has(term)),
      });
    }

    // Ordered by how many of the searched terms have supporting evidence — a
    // countable fact, shown to the user, never a hidden relevance score.
    results.sort((a, b) => {
      const byMatches = b.matches.length - a.matches.length;
      if (byMatches !== 0) return byMatches;
      return b.yearsOfExperience - a.yearsOfExperience;
    });

    return {
      query: input.query,
      interpretedTerms,
      results: results.slice(0, input.limit ?? 20),
      tookMs: Date.now() - startedAt,
    };
  }, 640);
}

export const SEARCH_EXAMPLES = [
  "Find candidates with production Kubernetes experience, Redis Pub/Sub and NestJS.",
  "Who has built a design system with React, TypeScript and the Next.js App Router?",
  "Data engineers with Airflow and dbt on a cloud warehouse.",
  "Backend engineers with PostgreSQL schema design and Terraform.",
];
