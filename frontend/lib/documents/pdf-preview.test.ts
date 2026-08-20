import { describe, expect, it } from "vitest";
import {
  documentPreviewPath,
  isPdfMimeType,
  isSameDocumentPreview,
  pdfFrameSource,
} from "@/lib/documents/pdf-preview";

describe("PDF document preview helpers", () => {
  it("uses a same-origin preview route instead of a signed storage URL", () => {
    expect(documentPreviewPath("abc 123")).toBe(
      "/api/documents/abc%20123/preview",
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
