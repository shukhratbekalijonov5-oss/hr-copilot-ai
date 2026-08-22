import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";

const PDF_CONTENT_TYPE = "application/pdf";

/**
 * Streams one of an applicant's CURRENT documents through the frontend
 * origin, for the embedded viewer.
 *
 * The backend/storage signed URL remains server-side, and the backend
 * re-verifies the owned-vacancy + applicant + current-ownership chain on
 * every call — a deleted or substituted document id is a 404, never a file.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/candidates/[id]/current-documents/[documentId]/preview">,
): Promise<Response> {
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
    const { url } = await api.getCandidateCurrentDocumentUrl(
      id,
      vacancyId,
      documentId,
    );
    const upstream = await fetch(url, { cache: "no-store" });

    if (!upstream.ok) {
      return NextResponse.json(
        { message: "Could not open this document." },
        { status: upstream.status },
      );
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") ?? PDF_CONTENT_TYPE,
    );
    headers.set(
      "Content-Disposition",
      upstream.headers.get("content-disposition") ?? "inline",
    );
    headers.set("Cache-Control", "private, no-store");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    const status = error instanceof ApiError ? error.status || 500 : 500;
    return NextResponse.json(
      { message: "Could not open this document." },
      { status },
    );
  }
}
