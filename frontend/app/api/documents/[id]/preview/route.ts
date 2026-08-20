import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";

const PDF_CONTENT_TYPE = "application/pdf";

/**
 * Streams an authorised document through the frontend origin.
 *
 * The backend/storage signed URL remains server-side. Browsers get a normal
 * same-origin PDF response, which avoids embedded-viewer quirks around private
 * cross-origin signed URLs while preserving the backend as the authority.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/documents/[id]/preview">,
): Promise<Response> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const { url } = await api.getDocumentDownloadUrl(id);
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
