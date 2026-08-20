import { describe, expect, it } from "vitest";
import {
  EXCERPT_LIMIT,
  evidencePreview,
  sectionKey,
} from "@/lib/ai/evidence-preview";
import { displaySnippet } from "@/lib/ai/snippet";

describe("sectionKey", () => {
  it("maps the chunker's section values, ignoring case and padding", () => {
    expect(sectionKey("experience")).toBe("experience");
    expect(sectionKey("  Skills ")).toBe("skills");
    expect(sectionKey("EDUCATION")).toBe("education");
  });

  it("returns null for unknown internal values and missing sections", () => {
    // The card then shows the generic localized heading instead of leaking
    // an internal value.
    expect(sectionKey("chunk_meta_v2")).toBeNull();
    expect(sectionKey(null)).toBeNull();
    expect(sectionKey("")).toBeNull();
  });
});

describe("evidencePreview — list detection", () => {
  it("renders a spaced skill list as tokens", () => {
    const preview = evidencePreview("Docker, Kubernetes, Redis, PostgreSQL");
    expect(preview).toEqual({
      kind: "list",
      tokens: ["Docker", "Kubernetes", "Redis", "PostgreSQL"],
      showOriginal: true,
    });
  });

  it("renders the parser's space-less comma dump as tokens", () => {
    const preview = evidencePreview(
      "NodeJS,ExpressJS,Python,PHP,MongoDB,NestJS",
    );
    expect(preview.kind).toBe("list");
    if (preview.kind === "list") {
      expect(preview.tokens).toEqual([
        "NodeJS",
        "ExpressJS",
        "Python",
        "PHP",
        "MongoDB",
        "NestJS",
      ]);
    }
  });

  it("keeps every source item and invents none", () => {
    const source = "rUI,KendoReact,Zustand,XState,NextJS,MaterialUI";
    const preview = evidencePreview(source);
    expect(preview.kind).toBe("list");
    if (preview.kind === "list") {
      // Token-set equality with the source's own split: nothing added,
      // nothing dropped, nothing "repaired" — "rUI" stays "rUI".
      expect(preview.tokens).toEqual(source.split(","));
    }
  });

  it("never treats comma-bearing prose as a list", () => {
    const prose =
      "Built responsive pages, integrated REST APIs, improved cross-browser compatibility, and supported the team with testing.";
    expect(evidencePreview(prose).kind).toBe("prose");
  });

  it("requires at least four items", () => {
    expect(evidencePreview("Docker, Kubernetes, Redis").kind).toBe("prose");
  });

  it("rejects lists containing clause-like entries", () => {
    expect(
      evidencePreview(
        "Docker, Kubernetes, maintained the on-call rotation for two years, Redis, PostgreSQL",
      ).kind,
    ).toBe("prose");
  });
});

describe("evidencePreview — prose excerpts", () => {
  it("shows short prose whole, with no toggle needed", () => {
    const text = "Helped maintain CI/CD pipelines using Docker and GitHub Actions.";
    expect(evidencePreview(text)).toEqual({
      kind: "prose",
      text,
      showOriginal: false,
    });
  });

  it("cuts long prose at a word boundary and keeps the original reachable", () => {
    const long =
      "Led the migration of the platform to a production Kubernetes cluster running on bare-metal servers in our Seoul datacentre including rolling deploys horizontal pod autoscaling and pod disruption budgets which reduced latency substantially.";
    const preview = evidencePreview(long);

    expect(preview.kind).toBe("prose");
    if (preview.kind === "prose") {
      expect(preview.showOriginal).toBe(true);
      expect(preview.text.endsWith("…")).toBe(true);
      expect(preview.text.length).toBeLessThanOrEqual(EXCERPT_LIMIT + 1);
      // No fabricated words: the excerpt (sans ellipsis) is an exact prefix
      // of the display text.
      expect(long.startsWith(preview.text.slice(0, -1))).toBe(true);
    }
  });

  it("excerpts malformed letter-spaced extraction without repairing it", () => {
    const spaced = `R a k h m a t i l l o A n d r e w ${"F u l l S t a c k ".repeat(20)}`;
    const preview = evidencePreview(spaced);

    expect(preview.kind).toBe("prose");
    if (preview.kind === "prose") {
      expect(preview.showOriginal).toBe(true);
      // Still letter-spaced: presentation only, never reconstruction.
      expect(preview.text.startsWith("R a k h m a t i l l o")).toBe(true);
      expect(
        displaySnippet(spaced).startsWith(preview.text.slice(0, -1)),
      ).toBe(true);
    }
  });

  it("hard-cuts a single enormous unbroken token rather than showing nothing", () => {
    const joined = "withtestinganddocumentationofinternalprojects".repeat(8);
    const preview = evidencePreview(joined);

    expect(preview.kind).toBe("prose");
    if (preview.kind === "prose") {
      expect(preview.showOriginal).toBe(true);
      expect(preview.text.length).toBeLessThanOrEqual(EXCERPT_LIMIT + 1);
      expect(joined.startsWith(preview.text.slice(0, -1))).toBe(true);
    }
  });
});
