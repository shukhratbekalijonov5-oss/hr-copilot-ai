import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/dictionaries/en";
import {
  isDocumentErrorCode,
  localizedDocumentError,
} from "@/lib/documents/errors";

describe("document error localization", () => {
  it("recognises the backend document policy codes", () => {
    expect(isDocumentErrorCode("FILE_TOO_LARGE")).toBe(true);
    expect(isDocumentErrorCode("UNSUPPORTED_FILE_TYPE")).toBe(true);
    expect(isDocumentErrorCode("PERSONAL_DOCUMENT_LIMIT_REACHED")).toBe(true);
    expect(isDocumentErrorCode("HR_DOCUMENT_UPLOAD_NOT_ALLOWED")).toBe(true);
    expect(isDocumentErrorCode("SOMETHING_ELSE")).toBe(false);
  });

  it("uses localized copy for known codes and fallback copy otherwise", () => {
    expect(
      localizedDocumentError(
        "PERSONAL_DOCUMENT_LIMIT_REACHED",
        en,
        "backend fallback",
      ),
    ).toContain("3 documents");
    expect(localizedDocumentError(null, en, "backend fallback")).toBe(
      "backend fallback",
    );
  });
});
