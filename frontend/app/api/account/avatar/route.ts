import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/api/session";

/**
 * The profile picture upload.
 *
 * A Route Handler and not a Server Action, for exactly the reason the
 * candidate document upload is one: a Server Action's arguments are serialised
 * into a single POST body that Next caps at 1 MB, so an image over that size
 * would die with "Body exceeded 1 MB limit" before any of our code ran. Every
 * other profile mutation — name, email, remove photo — stays a Server Action,
 * because none of them carry bytes.
 *
 * The body is relayed untouched rather than parsed: `request.formData()` here
 * would buffer the image in the Next process and the backend would buffer it
 * again, and re-encoding would break the multipart boundary the browser chose.
 *
 * It does NOT validate the image, and must not start. The size, MIME type,
 * extension and magic-number checks live in the backend, which is the only
 * place a caller cannot skip: posting straight to the API is refused by the
 * same rules. The ceiling below only bounds what this process will relay.
 */

/** The backend's MAX_AVATAR_BYTES (5 MB) plus room for the multipart envelope. */
const MAX_AVATAR_REQUEST_BYTES = 6 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ message: "Not signed in." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType?.includes("multipart/form-data")) {
    return NextResponse.json(
      { message: "Expected a multipart upload." },
      { status: 415 },
    );
  }

  // `content-length` is a client-supplied hint and a chunked upload omits it —
  // which is precisely why the backend still measures the real thing.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_AVATAR_REQUEST_BYTES) {
    return NextResponse.json(
      {
        message: "Image exceeds the upload size limit",
        // The same stable code the backend returns, so the UI localizes a
        // rejection here and a rejection there identically.
        code: "IMAGE_TOO_LARGE",
      },
      { status: 413 },
    );
  }

  if (!request.body) {
    return NextResponse.json(
      { message: "An image is required." },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/account/me/avatar`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        // Carries the boundary the browser generated; without it the multipart
        // body is unparseable.
        "content-type": contentType,
      },
      body: request.body,
      // Required by undici whenever the body is a stream.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch {
    return NextResponse.json(
      { message: "The upload service is unreachable." },
      { status: 503 },
    );
  }

  // Passed through verbatim — status AND body — because the UI localizes on
  // the backend's `code` (UNSUPPORTED_IMAGE_TYPE, IMAGE_TOO_LARGE).
  const text = await upstream.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { message: "The server returned an unreadable response." };
  }

  return NextResponse.json(payload ?? {}, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store" },
  });
}
