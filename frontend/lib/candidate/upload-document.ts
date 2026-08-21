import type { PersonalDocument } from "@/lib/types";

/**
 * Uploads one personal file from the browser.
 *
 * The bytes go to a Route Handler as multipart, deliberately NOT to a Server
 * Action: an action's arguments are serialised into one POST body that Next
 * caps at 1 MB, so a resume of any real size failed with "Body exceeded 1 MB
 * limit". Every other profile mutation is still a Server Action; only the
 * binary transfer moved.
 *
 * The return shape mirrors `CandidateResult` so the calling card's error
 * handling — which localizes on the backend's `code` — did not have to change.
 */
export type UploadResult =
  | { ok: true; data: PersonalDocument }
  | { ok: false; code?: string | null; message?: string };

const UPLOAD_URL = "/api/candidate-account/documents";

export async function uploadPersonalDocument(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    // No explicit Content-Type: the browser must set it so the multipart
    // boundary it generated is the one that gets sent.
    response = await fetch(UPLOAD_URL, { method: "POST", body: formData });
  } catch {
    // The upload never reached the server — offline, cancelled, or a proxy
    // that closed the connection. Reported as a failure with no code, so the
    // card shows its generic upload-failed message.
    return { ok: false };
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<PersonalDocument> & { code?: string; message?: string })
    | null;

  if (!response.ok) {
    return {
      ok: false,
      code: payload?.code ?? null,
      message: payload?.message,
    };
  }

  return { ok: true, data: payload as PersonalDocument };
}
