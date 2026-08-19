import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";

/**
 * Mints a signed URL for one document, on behalf of the signed-in user.
 *
 * The browser asks Next, Next asks the API with the session token, and the API
 * decides whether this tenant may read that file. No storage credential and no
 * long-lived document URL ever reaches the client.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/documents/[id]/url">,
): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const result = await api.getDocumentDownloadUrl(id);
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
