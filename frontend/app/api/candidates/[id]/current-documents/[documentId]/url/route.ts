import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";

/**
 * Mints a signed URL for one of an applicant's CURRENT documents.
 *
 * The browser asks Next, Next asks the API with the session token, and the
 * API re-verifies the whole chain — owned vacancy, legitimate applicant,
 * document currently belonging to that applicant's account — on every call.
 * No storage credential and no long-lived document URL ever reaches the
 * client, and `vacancyId` is required because the authorization is
 * vacancy-contextual.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/candidates/[id]/current-documents/[documentId]/url">,
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const { id, documentId } = await context.params;
  const vacancyId = new URL(request.url).searchParams.get("vacancyId");
  if (!vacancyId) {
    return NextResponse.json(
      { message: "vacancyId is required." },
      { status: 400 },
    );
  }

  try {
    const result = await api.getCandidateCurrentDocumentUrl(
      id,
      vacancyId,
      documentId,
    );
    return NextResponse.json(result, {
      // The URL is short-lived; caching it would outlive its signature.
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status || 500 : 500;
    return NextResponse.json(
      { message: "Could not open this document." },
      { status },
    );
  }
}
