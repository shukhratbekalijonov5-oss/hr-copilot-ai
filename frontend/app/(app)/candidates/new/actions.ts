"use server";

import { revalidatePath } from "next/cache";
import { api, ApiError } from "@/lib/api";
import type { FieldErrors } from "@/lib/api/errors";
import type { CreateCandidateInput } from "@/lib/types";

export type CreateCandidateResult =
  | { ok: true; candidateId: string; applicationFailed: boolean }
  | { ok: false; message: string; fieldErrors: FieldErrors };

/**
 * Creates a candidate and, when a vacancy is chosen, the application that links
 * them. Attaching to a vacancy is what gives the requirement checks something
 * to check against.
 */
export async function createCandidateAction(
  input: CreateCandidateInput,
  vacancyId: string | null,
): Promise<CreateCandidateResult> {
  let candidateId: string;

  try {
    const candidate = await api.createCandidate(input);
    candidateId = candidate.id;
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    return {
      ok: false,
      message: "Could not add the candidate. Try again.",
      fieldErrors: {},
    };
  }

  let applicationFailed = false;
  if (vacancyId) {
    try {
      await api.createApplication(candidateId, vacancyId);
    } catch {
      // The candidate exists either way; the link can be made again later.
      applicationFailed = true;
    }
  }

  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  if (vacancyId) revalidatePath(`/vacancies/${vacancyId}`);

  return { ok: true, candidateId, applicationFailed };
}
