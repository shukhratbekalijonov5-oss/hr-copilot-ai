import { describe, expect, it } from "vitest";
import {
  currentDocumentPreviewPath,
  currentDocumentUrlPath,
  isPdfMimeType,
  isSameDocumentPreview,
  pdfFrameSource,
} from "@/lib/documents/pdf-preview";

describe("PDF document preview helpers", () => {
  it("uses a same-origin preview route instead of a signed storage URL", () => {
    expect(currentDocumentPreviewPath("cand 1", "vac 1", "abc 123")).toBe(
      "/api/candidates/cand%201/current-documents/abc%20123/preview" +
        "?vacancyId=vac%201",
    );
  });

  it("addresses a CURRENT document by candidate AND vacancy", () => {
    // A bare document id would be a general-purpose file lookup. The route
    // carries the whole relationship so the backend can re-verify it: owned
    // vacancy -> legitimate applicant -> document the account owns NOW.
    expect(currentDocumentUrlPath("c1", "v1", "d1")).toBe(
      "/api/candidates/c1/current-documents/d1/url?vacancyId=v1",
    );
  });

  it("recognises PDF content types with optional parameters", () => {
    expect(isPdfMimeType("application/pdf")).toBe(true);
    expect(isPdfMimeType("application/pdf; charset=binary")).toBe(true);
    expect(isPdfMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      false,
    );
  });

  it("updates the iframe fragment when the active page changes", () => {
    expect(pdfFrameSource("blob:https://app/preview", 3)).toBe(
      "blob:https://app/preview#page=3&view=FitH",
    );
  });

  it("does not reuse preview state across documents", () => {
    expect(isSameDocumentPreview("doc-a", "doc-a")).toBe(true);
    expect(isSameDocumentPreview("doc-a", "doc-b")).toBe(false);
    expect(isSameDocumentPreview(null, "doc-a")).toBe(false);
  });
});
