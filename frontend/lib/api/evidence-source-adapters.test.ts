import { describe, expect, it } from "vitest";
import {
  aiReadiness,
  hostnameOf,
  toAiCitation,
  toCandidate,
  toCandidateLink,
  toCandidateLinkSource,
  toEvidenceSearchResult,
} from "@/lib/api/adapters";
import { displayUrl } from "@/lib/utils";

/**
 * Source provenance across the adapter layer.
 *
 * The rule under test throughout: a response WITHOUT source fields describes a
 * FILE. Chunks indexed before URL evidence existed carry no `sourceType`, and
 * they must keep rendering correctly — this is what makes the whole feature
 * additive rather than something requiring a destructive reindex.
 */

describe("citations", () => {
  it("carries URL provenance through", () => {
    const citation = toAiCitation({
      chunkId: "chunk-1",
      documentId: "src-1",
      fileName: "Portfolio Website",
      pageNumber: null,
      section: "projects",
      text: "Deployed a Kubernetes cluster.",
      sourceType: "URL",
      sourceTitle: "Portfolio Website",
      sourceUrl: "https://portfolio.example.com/projects",
    });

    expect(citation.sourceType).toBe("URL");
    expect(citation.sourceUrl).toBe("https://portfolio.example.com/projects");
    expect(citation.documentName).toBe("Portfolio Website");
  });

  it("defaults a citation with no source fields to a FILE", () => {
    const citation = toAiCitation({
      chunkId: "chunk-2",
      documentId: "doc-1",
      fileName: "resume.pdf",
      pageNumber: 2,
      section: "skills",
      text: "Kubernetes, Redis",
    });

    expect(citation.sourceType).toBe("FILE");
    expect(citation.sourceUrl).toBeNull();
    expect(citation.page).toBe(2);
  });

  it("prefers the source title over the raw file name", () => {
    const citation = toAiCitation({
      chunkId: "chunk-3",
      documentId: "src-2",
      fileName: null,
      pageNumber: null,
      section: null,
      text: "…",
      sourceType: "URL",
      sourceTitle: "GitHub",
      sourceUrl: "https://github.com/someone",
    });
    expect(citation.documentName).toBe("GitHub");
  });
});

describe("search results", () => {
  const hit = (over: Record<string, unknown> = {}) => ({
    candidateId: "cand-1",
    candidateName: "Ji-woo Han",
    documentId: "doc-1",
    fileName: "resume.pdf",
    section: "skills",
    pageNumber: 1,
    text: "React, Node",
    relevance: { retrievalScore: 0.4, rerankScore: 0.8 },
    ...over,
  });

  it("keeps file and link passages under one candidate", () => {
    const result = toEvidenceSearchResult({
      query: "kubernetes",
      results: [
        hit(),
        hit({
          documentId: "src-1",
          fileName: null,
          pageNumber: null,
          section: "projects",
          text: "Kubernetes deployment",
          sourceType: "URL",
          sourceTitle: "Portfolio Website",
          sourceUrl: "https://portfolio.example.com/projects",
        }),
      ],
      reranked: true,
      totalConsidered: 2,
      durationMs: 10,
    });

    expect(result.candidates).toHaveLength(1);
    const [file, link] = result.candidates[0].passages;
    expect(file.sourceType).toBe("FILE");
    expect(link.sourceType).toBe("URL");
    expect(link.documentName).toBe("Portfolio Website");
    expect(link.sourceUrl).toBe("https://portfolio.example.com/projects");
  });
});

describe("candidate detail", () => {
  it("maps submitted link sources alongside documents", () => {
    const candidate = toCandidate({
      id: "cand-1",
      organizationId: "org-1",
      candidateAccountId: "acct-1",
      fullName: "Ji-woo Han",
      email: null,
      phone: null,
      location: null,
      currentTitle: null,
      totalExperienceYears: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
      documents: [
        {
          id: "doc-1",
          type: "RESUME",
          originalFileName: "resume.pdf",
          status: "COMPLETED",
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      ],
      linkSources: [
        {
          id: "src-1",
          url: "https://portfolio.example.com/",
          title: "Portfolio Website",
          detectedType: "WEBSITE",
          status: "COMPLETED",
          charCount: 900,
          pagesFetched: 2,
          fetchedAt: "2026-08-20T00:00:00.000Z",
          createdAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    });

    expect(candidate.documents).toHaveLength(1);
    expect(candidate.linkSources).toHaveLength(1);
    expect(candidate.linkSources[0].title).toBe("Portfolio Website");
  });

  it("has an empty link list for a candidate who submitted none", () => {
    // Historical applications carry no links and must keep working.
    const candidate = toCandidate({
      id: "cand-2",
      organizationId: "org-1",
      candidateAccountId: "acct-2",
      fullName: "Marcus Osei",
      email: null,
      phone: null,
      location: null,
      currentTitle: null,
      totalExperienceYears: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(candidate.linkSources).toEqual([]);
    expect(candidate.documents).toEqual([]);
  });
});

describe("link sources", () => {
  it("falls back to the hostname when a source has no title", () => {
    const source = toCandidateLinkSource({
      id: "src-1",
      url: "https://www.portfolio.example.com/projects",
      title: null,
      detectedType: null,
      status: "COMPLETED",
      charCount: null,
      pagesFetched: null,
      fetchedAt: "2026-08-20T00:00:00.000Z",
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    expect(source.title).toBe("portfolio.example.com");
  });

  it("does the same for the candidate's own links", () => {
    const link = toCandidateLink({
      id: "link-1",
      url: "https://github.com/someone",
      title: null,
      detectedType: "GITHUB",
      status: "PENDING",
      failureCode: null,
      charCount: null,
      pagesFetched: null,
      lastFetchedAt: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    });
    expect(link.title).toBe("github.com");
    expect(link.status).toBe("PENDING");
  });
});

describe("aiReadiness with links", () => {
  const completed = { status: "COMPLETED" as const };
  const failed = { status: "FAILED" as const };
  const queued = { status: "QUEUED" as const };

  it("is ready when only a LINK is indexed", () => {
    // Gating the AI panels on files alone would hide answers the model can
    // genuinely give from a portfolio.
    expect(aiReadiness([failed], [completed])).toBe("ready");
  });

  it("is ready when only a FILE is indexed", () => {
    expect(aiReadiness([completed], [failed])).toBe("ready");
  });

  it("reports no sources when there are none of either kind", () => {
    expect(aiReadiness([], [])).toBe("no_documents");
  });

  it("reports processing while anything is still in flight", () => {
    expect(aiReadiness([failed], [queued])).toBe("processing");
  });

  it("reports failed only when everything failed", () => {
    expect(aiReadiness([failed], [failed])).toBe("failed");
  });

  it("keeps working for callers that pass documents only", () => {
    expect(aiReadiness([completed])).toBe("ready");
    expect(aiReadiness([])).toBe("no_documents");
  });
});

describe("URL display", () => {
  it("drops the scheme and www, which say nothing to a reader", () => {
    expect(displayUrl("https://www.portfolio.example.com/projects")).toBe(
      "portfolio.example.com/projects",
    );
  });

  it("drops a trailing slash", () => {
    expect(displayUrl("https://portfolio.example.com/")).toBe(
      "portfolio.example.com",
    );
  });

  it("elides a long URL instead of overflowing the layout", () => {
    const long = `https://portfolio.example.com/${"segment/".repeat(20)}end`;
    const shown = displayUrl(long, 48);

    expect(shown.length).toBeLessThanOrEqual(48);
    // The host says whose site it is, the tail says which page.
    expect(shown.startsWith("portfolio.example.com")).toBe(true);
    expect(shown).toContain("…");
    expect(shown.endsWith("end")).toBe(true);
  });

  it("returns something readable for an unparseable value", () => {
    expect(displayUrl("not a url")).toBe("not a url");
  });

  it("hostnameOf strips www and the path", () => {
    expect(hostnameOf("https://www.github.com/someone/repo")).toBe("github.com");
  });
});
