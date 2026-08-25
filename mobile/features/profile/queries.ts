import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, currentAccessToken } from "@/lib/api/client";
import { API_BASE_URL } from "@/constants/config";
import { ApiError, parseErrorBody } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type {
  CandidateAccount,
  CandidateDocument,
  CandidateDocumentList,
  JobPreferences,
} from "@/types";

/**
 * The candidate's own profile, documents and preferences.
 *
 * ## Current-only, and that is enforced by not caching around it
 *
 * A deleted document is withdrawn from every organization that could see it,
 * so the list must never show a row the server no longer returns. Every
 * mutation here invalidates rather than patches: patching would let a
 * stale row survive locally after the server dropped it, which is precisely
 * the thing the current-only rule exists to prevent.
 */
export function useCandidateAccount() {
  return useQuery({
    queryKey: queryKeys.candidate.account,
    queryFn: () => apiFetch<CandidateAccount>("/candidate-account/me"),
  });
}

export function useUpdateCandidateAccount() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<CandidateAccount>) =>
      apiFetch<CandidateAccount>("/candidate-account/me", {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.account });
    },
  });
}

/**
 * The candidate's documents, as the ENVELOPE the backend actually returns.
 *
 * `{data, limit, remaining, primaryDocumentId}` — not an array. Typing it as
 * `CandidateDocument[]` made `data.length` undefined and crashed the screen;
 * `remaining` is the authoritative cap state and is never derived from
 * `data.length` here.
 */
export function useCandidateDocuments() {
  return useQuery({
    queryKey: queryKeys.candidate.documents,
    queryFn: () =>
      apiFetch<CandidateDocumentList>("/candidate-account/me/documents"),
    /*
     * A freshly uploaded file is PENDING, then PROCESSING, then COMPLETED.
     * Polling only while something is in flight means a settled list costs
     * nothing, and a processing one updates without the reader pulling.
     */
    refetchInterval: (query) => {
      const rows = query.state.data?.data;
      if (!Array.isArray(rows)) return false;
      const busy = rows.some(
        (row) => row.status === "PENDING" || row.status === "PROCESSING" || row.status === "QUEUED",
      );
      return busy ? 4000 : false;
    },
  });
}

/**
 * Uploads one file.
 *
 * ## Why this is not `apiFetch`
 *
 * The shared client serialises JSON and sets `Content-Type: application/json`.
 * A multipart upload needs the platform to set its own boundary — passing a
 * `FormData` through a JSON client produces a body the backend cannot parse,
 * with a 400 that looks like a validation failure rather than a wiring bug.
 * So this is the ONE deliberate exception, and it still reads its token from
 * the same in-memory source as everything else.
 *
 * The 50MB ceiling and the 3-file cap are the backend's. This does not
 * re-check them: a second copy of a limit is a second thing to get wrong, and
 * the server's refusal (`PERSONAL_DOCUMENT_LIMIT_REACHED`) is what the UI
 * shows.
 */
export function useUploadDocument() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (file: { uri: string; name: string; mimeType?: string | null }) => {
      const form = new FormData();
      form.append("file", {
        uri: file.uri,
        name: file.name,
        type: file.mimeType ?? "application/octet-stream",
      } as unknown as Blob);

      const token = currentAccessToken();
      const response = await fetch(
        `${API_BASE_URL}/candidate-account/me/documents`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: form,
        },
      ).catch(() => {
        throw new ApiError("Could not reach the server.", 0, "network");
      });

      const text = await response.text();
      const parsed = text.length > 0 ? safeJson(text) : null;
      if (!response.ok) {
        throw parseErrorBody(parsed, response.status, "Upload failed.");
      }
      return parsed as CandidateDocument;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.documents });
      void client.invalidateQueries({ queryKey: queryKeys.candidate.evidence });
    },
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Deletes one document.
 *
 * This is not a local hide. Deleting withdraws the file from every
 * organization that had it in view, which is why the confirmation copy says
 * so and why the evidence state is invalidated alongside the list.
 */
export function useDeleteDocument() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/candidate-account/me/documents/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.documents });
      void client.invalidateQueries({ queryKey: queryKeys.candidate.evidence });
    },
  });
}

export function useReprocessDocument() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<CandidateDocument>(
        `/candidate-account/me/documents/${id}/reprocess`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.documents });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Job preferences                                                     */
/* ------------------------------------------------------------------ */

/**
 * What kind of job the candidate WANTS.
 *
 * An empty field means "not stated", never "reject everything". A 404 from
 * the backend means the candidate has never saved preferences, which is the
 * same thing as all-unstated — so it resolves to an empty object rather than
 * surfacing as an error the reader would have to dismiss.
 */
export function useJobPreferences() {
  return useQuery({
    queryKey: queryKeys.candidate.preferences,
    queryFn: async () => {
      try {
        return await apiFetch<JobPreferences>(
          "/candidate-account/me/job-preferences",
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return {};
        throw error;
      }
    },
  });
}

export function useSaveJobPreferences() {
  const client = useQueryClient();

  return useMutation({
    // PUT, not PATCH: the backend treats preferences as one whole statement,
    // so a partial send would clear the dimensions it omits.
    mutationFn: (preferences: JobPreferences) =>
      apiFetch<JobPreferences>("/candidate-account/me/job-preferences", {
        method: "PUT",
        body: preferences,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.preferences });
      // Preferences rank both job surfaces, so their results are now stale.
      void client.invalidateQueries({ queryKey: ["candidate", "jobMatches"] });
      void client.invalidateQueries({ queryKey: ["candidate", "externalJobs"] });
    },
  });
}

export function useClearJobPreferences() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<void>("/candidate-account/me/job-preferences", {
        method: "DELETE",
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.preferences });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Avatar                                                             */
/* ------------------------------------------------------------------ */

/** What the account endpoints answer with. `avatarUrl` is signed and short-lived. */
export interface AccountProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
}

/**
 * The image types the backend actually accepts.
 *
 * It verifies the MAGIC BYTES, not the declared type, so an mp4 renamed to
 * .png is refused server-side. Restricting the picker is a courtesy that
 * avoids a pointless round trip; it is not the check that matters.
 */
export const AVATAR_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Uploads or replaces the profile picture.
 *
 * ## The multipart field is `file`
 *
 * `FileInterceptor('file')` on the backend means any other field name arrives
 * as no file at all — a 400 that reads like a validation bug rather than a
 * naming one. Same reason this bypasses `apiFetch` as the document upload
 * does: a JSON client would set its own `Content-Type` and destroy the
 * multipart boundary.
 *
 * The size ceiling and the type check are the server's. This does not
 * duplicate either; it surfaces the refusal.
 */
export function useUploadAvatar() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (image: { uri: string; name: string; mimeType?: string | null }) => {
      const form = new FormData();
      form.append("file", {
        uri: image.uri,
        name: image.name,
        type: image.mimeType ?? "image/jpeg",
      } as unknown as Blob);

      const token = currentAccessToken();
      const response = await fetch(`${API_BASE_URL}/account/me/avatar`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      }).catch(() => {
        throw new ApiError("Could not reach the server.", 0, "network");
      });

      const text = await response.text();
      const parsed = text.length > 0 ? safeJson(text) : null;
      if (!response.ok) {
        throw parseErrorBody(parsed, response.status, "Upload failed.");
      }
      return parsed as AccountProfile;
    },
    onSuccess: () => {
      // The session carries the avatar, so both have to be re-read.
      void client.invalidateQueries({ queryKey: queryKeys.candidate.account });
      void client.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

/** Clears the picture. The account itself is untouched. */
export function useDeleteAvatar() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<AccountProfile>("/account/me/avatar", { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.candidate.account });
      void client.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}
