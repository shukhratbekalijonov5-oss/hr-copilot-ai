import { describe, expect, it } from "vitest";
import {
  SNIPPET_PREVIEW_LIMIT,
  displaySnippet,
  isLongSnippet,
} from "@/lib/ai/snippet";

describe("displaySnippet", () => {
  it("collapses whitespace runs and trims the ends — presentation only", () => {
    expect(displaySnippet("  Designed   PostgreSQL\n\nschemas \t daily  ")).toBe(
      "Designed PostgreSQL schemas daily",
    );
  });

  it("preserves malformed extraction verbatim rather than repairing it", () => {
    // Letter-spaced parser output stays what it is: single spaces are
    // untouched, so the reader sees what the document actually yielded.
    const spaced = "R a k h m a t i l l o A n d r e w";
    expect(displaySnippet(spaced)).toBe(spaced);

    const joined = "FullStackDeveloperContactVisaLanguages";
    expect(displaySnippet(joined)).toBe(joined);
  });

  it("never adds, removes or reorders non-whitespace characters", () => {
    const noisy = "  He lped   maintain\nCI/CD  pipelines [2021]  ";
    expect(displaySnippet(noisy).replace(/ /g, "")).toBe(
      noisy.replace(/\s/g, ""),
    );
  });
});

describe("isLongSnippet", () => {
  it("keeps short snippets unclamped", () => {
    expect(isLongSnippet("Maintained CI/CD pipelines using Docker.")).toBe(false);
  });

  it("clamps once the display length crosses the preview limit", () => {
    expect(isLongSnippet("x".repeat(SNIPPET_PREVIEW_LIMIT))).toBe(false);
    expect(isLongSnippet("x".repeat(SNIPPET_PREVIEW_LIMIT + 1))).toBe(true);
  });

  it("measures the displayed text, not raw whitespace padding", () => {
    // 300 chars of padding around short content must not trigger a clamp.
    expect(isLongSnippet(`${" ".repeat(300)}short${" ".repeat(300)}`)).toBe(false);
  });
});
