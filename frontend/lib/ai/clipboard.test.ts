import { describe, expect, it, vi } from "vitest";
import { copyToClipboard, coverLetterClipboardText } from "@/lib/ai/clipboard";

/**
 * The two paths a real browser will not produce on demand, and which are the
 * only ones that matter: the API is missing, and the API rejects.
 */

describe("copying succeeds", () => {
  it("writes the text and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyToClipboard("Dear team", { writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("Dear team");
  });
});

describe("copying fails, and says so", () => {
  it("reports failure when the clipboard API is absent", async () => {
    // Not a secure context, or an old browser. The button must not claim
    // success — the reader would paste something else into an application.
    expect(await copyToClipboard("Dear team", undefined)).toBe(false);
  });

  it("reports failure when the API exists but is not callable", async () => {
    expect(
      await copyToClipboard("Dear team", {} as unknown as { writeText: (t: string) => Promise<void> }),
    ).toBe(false);
  });

  it("reports failure when the browser rejects the write", async () => {
    // Permissions policy, an unfocused document, a user denial.
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    expect(await copyToClipboard("Dear team", { writeText })).toBe(false);
  });

  it("never throws, whatever the clipboard does", async () => {
    const writeText = vi.fn().mockImplementation(() => {
      throw new Error("sync throw");
    });
    await expect(copyToClipboard("x", { writeText })).resolves.toBe(false);
  });

  it("refuses to report success for an empty string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyToClipboard("", { writeText })).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("what actually lands on the clipboard", () => {
  it("puts the subject above the body, blank line between", () => {
    expect(coverLetterClipboardText("Application for X", "Dear team,\nHello.")).toBe(
      "Application for X\n\nDear team,\nHello.",
    );
  });

  it("copies the body alone when there is no subject", () => {
    expect(coverLetterClipboardText(null, "Dear team,")).toBe("Dear team,");
  });

  it("copies nothing when there is no body", () => {
    // A subject line alone is not the thing the button offered.
    expect(coverLetterClipboardText("Application for X", null)).toBe("");
  });
});
