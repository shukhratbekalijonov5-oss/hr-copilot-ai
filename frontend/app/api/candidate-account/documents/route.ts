import { NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/api/session";
import { MAX_UPLOAD_REQUEST_BYTES } from "@/lib/constants";

/**
 * The candidate's own file upload.
 *
 * ## Why this is a Route Handler and not a Server Action
 *
 * Everything else on the profile — saving the form, adding a link, deleting a
 * document — is a Server Action, and stays one. Uploads cannot be, because a
 * Server Action's arguments are serialised into a single POST body that Next
 * caps at 1 MB by default. A 50 MB resume therefore failed with
 * "Body exceeded 1 MB limit" before any of our code ran.
 *
 * Raising `serverActions.bodySizeLimit` to 50 MB+ would fix the symptom and
 * make it worse elsewhere: the limit is global, so EVERY action on every screen
 * would accept 50 MB bodies, and the file would still be encoded into an action
 * payload and buffered in the Next process. A route handler has no such cap,
 * takes the multipart stream as-is, and is scoped to this one endpoint.
 *
 * ## Why it streams rather than parsing
 *
 * Calling `request.formData()` here would buffer the whole file in the Next
 * process, and the backend buffers it again — 100 MB of RAM for one 50 MB
 * upload. So the body is passed through untouched: no parse, no re-encode, and
 * the multipart boundary the browser chose survives intact.
 *
 * ## What this does NOT do
 *
 * It does not validate the file, and must not start: the size, MIME type,
 * extension and magic-number checks all live in the backend, which is the only
 * place that cannot be bypassed. The ceiling below is a bound on what this
 * process will relay, not a replacement for that. A caller who skips this route
 * and posts straight to the API is refused by exactly the same rules.
 */
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

  /*
    Refuse an oversized body BEFORE relaying it.

    This is not the product limit — the backend owns that — it is the bound
    that stops this route being used to funnel unlimited bytes at the API. It
    sits above 50 MB because a multipart envelope adds headers and a boundary
    around the file, so a valid 50 MB file arrives as a slightly larger body;
    a ceiling of exactly 50 MB here would reject files the product allows and
    the backend accepts.

    `content-length` is a client-supplied hint and a chunked upload omits it
    entirely, which is precisely why the backend still measures the real thing.
  */
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_REQUEST_BYTES) {
    return NextResponse.json(
      {
        message: "File exceeds the upload size limit",
        // The same stable code the backend returns, so the UI localizes this
        // rejection and a backend rejection identically.
        code: "FILE_TOO_LARGE",
      },
      { status: 413 },
    );
  }

  if (!request.body) {
    return NextResponse.json({ message: "A file is required." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/candidate-account/me/documents`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        // Carries the boundary the browser generated; without it the multipart
        // body is unparseable.
        "content-type": contentType,
      },
      body: request.body,
      // Required by undici whenever the body is a stream: this request sends
      // its body before reading the response. Not yet in the DOM RequestInit
      // types, hence the cast.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch {
    return NextResponse.json(
      { message: "The upload service is unreachable." },
      { status: 503 },
    );
  }

  // The reply is a small JSON object, so it is read rather than streamed. It is
  // passed through verbatim — status AND body — because the UI localizes on the
  // backend's `code` (FILE_TOO_LARGE, UNSUPPORTED_FILE_TYPE,
  // PERSONAL_DOCUMENT_LIMIT_REACHED). Rewriting it here would break that.
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
