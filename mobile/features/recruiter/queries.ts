import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { usePagedQuery } from "@/lib/query/pagination";
import type { OrganizationStats, Vacancy } from "@/types";

/**
 * Recruiter server state.
 *
 * Ownership and tenant scoping are settled entirely by the backend — these
 * hooks send no organization id and filter nothing locally, so a vacancy this
 * recruiter may not act on simply never arrives.
 */
export function useRecruiterDashboard() {
  return useQuery({
    queryKey: queryKeys.recruiter.dashboard,
    queryFn: () =>
      /*
       * The organization's own counters. There is no `/dashboard` route on
       * this backend — the recruiting overview is assembled from this one
       * stats read, exactly as the web client does it.
       */
      apiFetch<OrganizationStats>("/organizations/current/stats"),
  });
}

export function useVacancies() {
  return usePagedQuery<Vacancy>(
    queryKeys.recruiter.vacancies(0),
    "/vacancies",
  );
}

/**
 * The vacancies this recruiter personally created.
 *
 * ## The only correct source for a vacancy picker
 *
 * Every vacancy-scoped surface — candidates, evidence, compare, interview
 * questions — is refused with `VACANCY_NOT_OWNED` for a vacancy somebody
 * else created. Offering the whole organization's list in a picker therefore
 * builds a menu of options that mostly 403, which reads as a broken app
 * rather than as the ownership rule it is.
 */
export function useMyVacancies() {
  return usePagedQuery<Vacancy>(
    ["recruiter", "vacancies", "mine"] as const,
    "/vacancies/mine",
  );
}

/**
 * Vacancy writes.
 *
 * ## Ownership is the backend's rule, and it stays there
 *
 * A recruiter acts only on vacancies they created — the server answers
 * `VACANCY_NOT_OWNED` otherwise. This app does not pre-filter by ownership
 * or hide controls based on a local guess: a hidden button that the server
 * would have allowed is as wrong as a visible one it refuses, and only one
 * of those two mistakes is visible in testing.
 */
export function useCreateVacancy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: { title: string; description?: string; location?: string }) =>
      apiFetch<Vacancy>("/vacancies", { method: "POST", body: input }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["recruiter", "vacancies"] });
      void client.invalidateQueries({ queryKey: queryKeys.recruiter.dashboard });
    },
  });
}

export function useUpdateVacancy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; description?: string; location?: string }) =>
      apiFetch<Vacancy>(`/vacancies/${id}`, { method: "PATCH", body: patch }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ["recruiter", "vacancies"] });
      void client.invalidateQueries({ queryKey: queryKeys.recruiter.vacancy(variables.id) });
    },
  });
}

export function useDeleteVacancy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/vacancies/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["recruiter", "vacancies"] });
      void client.invalidateQueries({ queryKey: queryKeys.recruiter.dashboard });
    },
  });
}

export function useCloseVacancy() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Vacancy>(`/vacancies/${id}/close`, { method: "PATCH" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["recruiter", "vacancies"] });
    },
  });
}
