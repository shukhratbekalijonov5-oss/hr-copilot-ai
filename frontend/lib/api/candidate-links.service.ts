import "server-only";

import { apiFetch } from "@/lib/api/http";
import { toCandidateLink } from "@/lib/api/adapters";
import type {
  CandidateLinkResponse,
  CandidateLinksResponse,
} from "@/lib/api/contracts";
import type {
  CandidateLink,
  CandidateLinkCollection,
  CandidateLinkInput,
} from "@/lib/types";

/**
 * The signed-in job seeker's own professional links.
 *
 * Every route is `/candidate-account/me/links/...` — no id in any path but the
 * link's own, because the subject is always the caller. There is deliberately
 * no recruiter-side counterpart anywhere in this codebase: HR cannot add, edit,
 * remove or refresh anybody's links, exactly as they cannot upload anybody's
 * files.
 */

/** GET — the caller's links plus the remaining slot count for the UI. */
export function getCandidateLinks(): Promise<CandidateLinkCollection> {
  return apiFetch<CandidateLinksResponse>("/candidate-account/me/links").then(
    (response) => ({
      links: response.data.map(toCandidateLink),
      limit: response.limit,
      remaining: response.remaining,
    }),
  );
}

/** POST — adds a link and queues the fetch. 409 on the fourth. */
export function createCandidateLink(
  input: CandidateLinkInput,
): Promise<CandidateLink> {
  return apiFetch<CandidateLinkResponse>("/candidate-account/me/links", {
    method: "POST",
    body: input,
  }).then(toCandidateLink);
}

/**
 * PATCH — edits the URL and/or the label.
 *
 * A changed URL is a different source: the backend clears the old content and
 * re-fetches. Applications already submitted are untouched.
 */
export function updateCandidateLink(
  id: string,
  input: CandidateLinkInput,
): Promise<CandidateLink> {
  return apiFetch<CandidateLinkResponse>(`/candidate-account/me/links/${id}`, {
    method: "PATCH",
    body: input,
  }).then(toCandidateLink);
}

/** DELETE — removes the link and its personal index entries. */
export function deleteCandidateLink(id: string): Promise<{ id: string }> {
  return apiFetch(`/candidate-account/me/links/${id}`, { method: "DELETE" });
}

/**
 * POST :id/reprocess — retry a transient failure, or refresh a changed page.
 *
 * The backend refuses permanent failures with a typed 409 rather than
 * pretending a retry could help.
 */
export function reprocessCandidateLink(id: string): Promise<CandidateLink> {
  return apiFetch<CandidateLinkResponse>(
    `/candidate-account/me/links/${id}/reprocess`,
    { method: "POST" },
  ).then(toCandidateLink);
}
