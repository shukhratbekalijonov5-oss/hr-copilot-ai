import { describe, expect, it } from "vitest";
import { hasInlineCitations, segmentAnswer } from "@/lib/ai/answer-citations";
import type { Citation } from "@/lib/types";

function citation(chunkId: string, page: number): Citation {
  return {
    id: chunkId,
    chunkId,
    documentId: "doc-1",
    documentName: "resume.pdf",
    page,
    section: "experience",
    snippet: "…",
  };
}

const A = "a755cd78-43f3-5b3a-a9a1-000000000001";
const B = "bd031988-be19-508a-b9a1-000000000002";
const citations = [citation(A, 1), citation(B, 2)];

describe("segmentAnswer", () => {
  it("replaces a chunk-id marker with a numbered reference to its citation", () => {
    const segments = segmentAnswer(`Used PostgreSQL [${A}] in production.`, citations);

    expect(segments).toEqual([
      { kind: "text", text: "Used PostgreSQL " },
      { kind: "citation", index: 1, citation: citations[0] },
      { kind: "text", text: " in production." },
    ]);
  });

  it("numbers markers by their position in the citation list, not by appearance", () => {
    const segments = segmentAnswer(`First [${B}] then [${A}].`, citations);
    const indexes = segments
      .filter((s) => s.kind === "citation")
      .map((s) => (s.kind === "citation" ? s.index : 0));

    // B is the second citation, so it stays [2] even though it appears first.
    expect(indexes).toEqual([2, 1]);
  });

  it("drops a marker whose chunk id was not returned as a citation", () => {
    const unknown = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const segments = segmentAnswer(`Claim [${unknown}] stands.`, citations);

    expect(segments.some((s) => s.kind === "citation")).toBe(false);
    expect(segments.map((s) => (s.kind === "text" ? s.text : "")).join("")).toBe(
      "Claim  stands.",
    );
  });

  it("leaves ordinary bracketed text alone", () => {
    const segments = segmentAnswer("Worked on [internal tooling] for a year.", citations);
    expect(segments).toEqual([
      { kind: "text", text: "Worked on [internal tooling] for a year." },
    ]);
  });

  it("handles an answer with no markers at all", () => {
    expect(segmentAnswer("No citations here.", citations)).toEqual([
      { kind: "text", text: "No citations here." },
    ]);
  });

  it("handles repeated markers for the same passage", () => {
    const segments = segmentAnswer(`One [${A}] and two [${A}].`, citations);
    const indexes = segments
      .filter((s) => s.kind === "citation")
      .map((s) => (s.kind === "citation" ? s.index : 0));
    expect(indexes).toEqual([1, 1]);
  });

  it("preserves the full answer text when markers are stripped", () => {
    const answer = `Alpha [${A}] beta [${B}] gamma.`;
    const text = segmentAnswer(answer, citations)
      .map((s) => (s.kind === "text" ? s.text : ""))
      .join("");
    expect(text).toBe("Alpha  beta  gamma.");
  });

  it("works with a non-Latin answer body", () => {
    const segments = segmentAnswer(`지원자는 PostgreSQL을 사용했습니다 [${A}].`, citations);
    expect(segments[0]).toEqual({
      kind: "text",
      text: "지원자는 PostgreSQL을 사용했습니다 ",
    });
    expect(segments[1]).toEqual({
      kind: "citation",
      index: 1,
      citation: citations[0],
    });
  });
});

describe("hasInlineCitations", () => {
  it("is true only when a marker resolves to a returned citation", () => {
    expect(hasInlineCitations(`x [${A}]`, citations)).toBe(true);
    expect(hasInlineCitations("x", citations)).toBe(false);
    expect(
      hasInlineCitations(`x [ffffffff-ffff-4fff-8fff-ffffffffffff]`, citations),
    ).toBe(false);
  });
});

describe("segmentAnswer — marker shapes the model actually emits", () => {
  it("expands several ids inside one bracket", () => {
    const segments = segmentAnswer(`Both hold [${A}, ${B}].`, citations);
    const indexes = segments
      .filter((s) => s.kind === "citation")
      .map((s) => (s.kind === "citation" ? s.index : 0));
    expect(indexes).toEqual([1, 2]);
    expect(segments.map((s) => (s.kind === "text" ? s.text : "")).join("")).toBe(
      "Both hold .",
    );
  });

  it("handles a semicolon-separated bracket", () => {
    const segments = segmentAnswer(`Both [${A}; ${B}] apply.`, citations);
    expect(segments.filter((s) => s.kind === "citation")).toHaveLength(2);
  });

  it("handles adjacent brackets", () => {
    const segments = segmentAnswer(`Claim [${A}][${B}].`, citations);
    expect(segments.filter((s) => s.kind === "citation")).toHaveLength(2);
  });

  it("removes a bare chunk id emitted without brackets", () => {
    // A raw identifier is never meaningful to a reader, bracketed or not.
    const segments = segmentAnswer(`Used Redis ${A} in production.`, citations);
    expect(segments.filter((s) => s.kind === "citation")).toHaveLength(1);
    expect(
      segments.map((s) => (s.kind === "text" ? s.text : "")).join(""),
    ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("leaves no raw chunk id in the rendered text, whatever the shape", () => {
    const unknown = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const answer = `a [${A}] b [${A}, ${unknown}] c ${unknown} d [${B}][${A}]`;
    const text = segmentAnswer(answer, citations)
      .map((s) => (s.kind === "text" ? s.text : ""))
      .join("");
    expect(text).not.toMatch(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}/);
  });

  it("still leaves ordinary bracketed prose untouched", () => {
    const segments = segmentAnswer("Ran [the migration] in 2024.", citations);
    expect(segments).toEqual([
      { kind: "text", text: "Ran [the migration] in 2024." },
    ]);
  });
});
