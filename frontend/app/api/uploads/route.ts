import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/api/session";
import {
  ACCEPTED_RESUME_EXTENSIONS,
  ACCEPTED_RESUME_MIME_TYPES,
  MAX_RESUME_SIZE_BYTES,
} from "@/lib/constants";
import type { DocumentType } from "@/lib/types";

/**
 * Upload proxy: browser → Next → NestJS → storage → BullMQ.
 *
 * The browser posts here rather than to the API directly so the JWT can stay in
 * an httpOnly cookie, and so the file never touches the Python service or any
 * storage bucket directly. No storage credential exists in this process.
 *
 * One file per request: the API's endpoint takes a single `file`, and this also
 * gives the uploader real per-file progress via XHR.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json(
      { message: "Your session has expired. Sign in again to continue." },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { message: "The upload could not be read." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "A file is required." }, { status: 400 });
  }

  // Mirrors the backend's own rules so an obviously invalid file is rejected
  // before it crosses the network. The backend re-validates regardless — it
  // additionally checks magic numbers, which is the check that actually counts.
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (
    !(ACCEPTED_RESUME_EXTENSIONS as readonly string[]).includes(extension) ||
    !(ACCEPTED_RESUME_MIME_TYPES as readonly string[]).includes(file.type)
  ) {
    return NextResponse.json(
      { message: "Unsupported file type. Upload a PDF or DOCX." },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ message: "File is empty." }, { status: 400 });
  }
  if (file.size > MAX_RESUME_SIZE_BYTES) {
    return NextResponse.json(
      {
        message: `File is larger than the ${MAX_RESUME_SIZE_BYTES / 1024 / 1024} MB limit.`,
        code: "FILE_TOO_LARGE",
      },
      { status: 400 },
    );
  }

  const candidateIdValue = formData.get("candidateId");
  if (typeof candidateIdValue !== "string" || !candidateIdValue) {
    return NextResponse.json(
      {
        message: "Upload from a manual candidate page.",
        code: "HR_DOCUMENT_UPLOAD_NOT_ALLOWED",
      },
      { status: 400 },
    );
  }

  const typeValue = formData.get("type");

  try {
    const document = await api.uploadDocument(file, {
      candidateId: candidateIdValue,
      type:
        typeof typeValue === "string" && typeValue
          ? (typeValue as DocumentType)
          : "RESUME",
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          message: error.message,
          fieldErrors: error.fieldErrors,
          code: error.code,
        },
        { status: error.status || 500 },
      );
    }
    return NextResponse.json(
      { message: "Upload failed. Try again." },
      { status: 500 },
    );
  }
}
