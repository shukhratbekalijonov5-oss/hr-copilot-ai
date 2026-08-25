import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromCitation, fromMatchEvidence } from "@/lib/workspace/evidence-view";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import type { Citation, MatchEvidence } from "@/lib/types";

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function code(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const citation: Citation = {
  id: "c1",
  chunkId: "chunk-1",
  documentId: "d1",
  documentName: "resume.pdf",
  page: 3,
  section: "experience",
  snippet: "Built NestJS services for the payments team.",
  sourceType: "FILE",
  sourceUrl: null,
};

const matchEvidence: MatchEvidence = {
  fileName: "resume.pdf",
  pageNumber: null,
  section: "experience",
  text: "Built NestJS services for the payments team.",
  sourceType: "FILE",
  sourceUrl: null,
};

describe("evidence normalisation", () => {
  it("carries a recruiter citation through verbatim", () => {
    expect(fromCitation(citation, 2)).toEqual({
      index: 2,
      snippet: citation.snippet,
      section: "experience",
      fileName: "resume.pdf",
      page: 3,
      sourceType: "FILE",
      sourceUrl: null,
    });
  });

  it("carries candidate match evidence through verbatim", () => {
    expect(fromMatchEvidence(matchEvidence, 1)).toEqual({
      index: 1,
      snippet: matchEvidence.text,
      section: "experience",
      fileName: "resume.pdf",
      page: null,
      sourceType: "FILE",
      sourceUrl: null,
    });
  });

  it("never invents a page the backend did not report", () => {
    expect(fromMatchEvidence(matchEvidence, 1).page).toBeNull();
    expect(fromCitation({ ...citation, page: null }, 1).page).toBeNull();
  });

  it("never rewrites the snippet", () => {
    const messy = "  Line one\n\n  • bullet  ";
    expect(fromMatchEvidence({ ...matchEvidence, text: messy }, 1).snippet).toBe(
      messy,
    );
  });

  it("narrows an unknown source type to FILE rather than guessing", () => {
    const url = fromCitation({ ...citation, sourceType: "URL", sourceUrl: "https://x.test" }, 1);
    expect(url.sourceType).toBe("URL");
    expect(url.sourceUrl).toBe("https://x.test");
    expect(fromMatchEvidence(matchEvidence, 1).sourceType).toBe("FILE");
  });

  it("holds no state and copies nothing into storage", () => {
    const source = code("lib/workspace/evidence-view.ts");
    expect(source).not.toMatch(/localStorage|sessionStorage|let |cache/);
  });
});

describe("evidence drawer", () => {
  const drawer = code("components/workspace/EvidenceDrawer.tsx");
  const shell = code("components/workspace/SideDrawer.tsx");

  it("renders the passage verbatim, preserving its line breaks", () => {
    expect(drawer).toContain("whitespace-pre-wrap");
    expect(drawer).toContain("{evidence.snippet}");
    // Never summarised, never translated.
    expect(drawer).not.toMatch(/slice\(|substring\(|truncate\(/);
  });

  it("shows a page only when one was reported", () => {
    expect(drawer).toContain("evidence.page !== null");
    expect(drawer).toContain("d.ai.evidenceSourceUnknown");
  });

  it("uses dialog semantics and closes on Escape", () => {
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain("aria-labelledby={titleId}");
  });

  it("moves focus in and returns it on close", () => {
    expect(shell).toContain("panelRef.current?.focus()");
    expect(shell).toContain("openerRef.current?.focus?.()");
  });

  it("becomes full width on narrow screens", () => {
    expect(shell).toContain("w-full");
    expect(shell).toContain("sm:w-[26rem]");
  });

  it("localizes every drawer label", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of [
        "evidenceDrawerTitle",
        "evidenceSnippet",
        "evidenceSource",
        "evidenceSourceUnknown",
        "viewEvidenceAction",
      ] as const) {
        expect(dictionary.ai[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("respects reduced motion through the shared global block", () => {
    const css = read("app/globals.css");
    expect(css).toContain("@keyframes drawer-in");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important;");
  });
});

describe("evidence drawer is wired to both sides", () => {
  it("opens from a recruiter citation without leaving the answer", () => {
    const list = code("components/ai/CitationList.tsx");
    expect(list).toContain("EvidenceDrawer");
    expect(list).toContain("fromCitation(citations[inspected], inspected + 1)");
    // The document-viewer jump is a DIFFERENT action and must still exist.
    expect(list).toContain("onSelectCitation");
  });

  it("opens from candidate match evidence", () => {
    const list = code("components/candidate/MatchEvidenceList.tsx");
    expect(list).toContain("EvidenceDrawer");
    expect(list).toContain("fromMatchEvidence(open");
  });

  it("reads only live evidence — no snapshot is stored anywhere", () => {
    for (const file of [
      "components/ai/CitationList.tsx",
      "components/candidate/MatchEvidenceList.tsx",
      "components/workspace/EvidenceDrawer.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/localStorage|sessionStorage/);
    }
  });
});

describe("split view", () => {
  const split = code("components/workspace/SplitView.tsx");

  it("only splits where there is room, and keeps the pane mounted", () => {
    expect(split).toContain("xl:grid-cols-");
    // `hidden xl:block` rather than a conditional render, so a selection
    // survives a resize across the breakpoint.
    expect(split).toContain("hidden min-w-0 xl:block");
  });

  it("says something when nothing is selected", () => {
    expect(split).toContain("hasSelection ? preview : emptyPreview");
    expect(split).toContain('aria-live="polite"');
  });

  it("labels both panes", () => {
    expect(split).toContain("aria-label={listLabel}");
    expect(split).toContain("aria-label={previewLabel}");
  });
});

describe("HR candidate workspace", () => {
  const view = code("components/candidates/CandidateListView.tsx");
  const preview = code("components/candidates/CandidatePreview.tsx");

  it("selects by id, so a re-filter cannot strand a stale row", () => {
    expect(view).toContain("const [selectedId, setSelectedId] = useState<string | null>(null)");
    expect(view).toContain(
      "filtered.find((candidate) => candidate.id === selectedId) ?? null",
    );
  });

  it("keeps the dense table below the split breakpoint", () => {
    expect(view).toContain("hidden md:block xl:hidden");
    expect(view).toContain("hidden xl:block");
    // Mobile cards are untouched by this task.
    expect(view).toContain("md:hidden");
  });

  it("carries the vacancy context into the detail link", () => {
    expect(preview).toContain("VACANCY_PARAM");
    expect(preview).toContain('vacancyId !== "all" ? vacancyId : candidate.primaryVacancyId');
  });

  it("previews only fields the list payload already carries", () => {
    // No per-selection fetch, and nothing the endpoint does not return.
    expect(preview).not.toMatch(/useQuery|fetch\(|api\./);
    expect(preview).not.toMatch(/score|summary|matchBand/i);
  });

  it("marks the selected row for assistive tech", () => {
    expect(view).toContain('aria-current={active ? "true" : undefined}');
  });
});

describe("candidate match workspace", () => {
  const workspace = code("components/candidate/JobMatchWorkspace.tsx");

  it("selects by slug and resolves against the current ranking", () => {
    expect(workspace).toContain("const [selectedSlug, setSelectedSlug]");
    expect(workspace).toContain(
      "result?.matches.find((match) => match.vacancy.slug === selectedSlug) ?? null",
    );
  });

  it("keeps the stacked cards below the split breakpoint", () => {
    expect(workspace).toContain("flex flex-col gap-3 xl:hidden");
    expect(workspace).toContain("hidden xl:block");
  });

  it("shows the backend's own band and score, never a recomputed one", () => {
    expect(workspace).toContain("Math.round(match.score)");
    expect(workspace).toContain("d.jobMatch.band[match.band]");
    expect(workspace).not.toMatch(/score\s*[*/+]\s*\d/);
  });

  it("reuses the full match card as the preview", () => {
    // One implementation of a match, not a second summary that could drift.
    expect(workspace).toContain("<MatchCard\n                          match={selectedMatch}");
  });
});

describe("role isolation is untouched", () => {
  it("keeps the recruiter preview out of candidate code and vice versa", () => {
    expect(code("components/candidate/JobMatchWorkspace.tsx")).not.toContain(
      "CandidatePreview",
    );
    expect(code("components/candidates/CandidateListView.tsx")).not.toContain(
      "MatchCard",
    );
  });
});
