import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import { MATCH_BREAKDOWN_STATUSES } from "@/lib/types";

/**
 * The fourth tool, and the two rules that are specific to it.
 *
 * Everything the other AI-tool guards protect applies here as well. What is
 * new is arithmetic:
 *
 *   - A ring, bar or percentage assembled from four statuses. It is the most
 *     natural thing in the world to add to a "breakdown", it looks like polish,
 *     and it would put a frontend-invented number beside the ranker's real one
 *     with no way for a reader to tell them apart.
 *   - UNKNOWN rendered like GAP. An employer who published no salary has not
 *     published a bad salary; collapsing the two lets this product manufacture
 *     reasons a candidate falls short out of an employer's silence.
 */

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

/** The body of a component's `generate()`, imports excluded. */
function generateBody(source: string): string {
  const start = source.indexOf("function generate()");
  return start === -1 ? "" : source.slice(start);
}

const FEATURE = "components/external/ExternalMatchBreakdown.tsx";
const LIST = "components/ai/AiDimensionList.tsx";
const TOOLS = "components/external/ExternalAiTools.tsx";

/* -------------------------------------------------------------------------- */

describe("the fourth tab exists and is lazy", () => {
  it("is registered as one more entry in the tools array", () => {
    const source = code(TOOLS);
    expect(source).toContain('id: "match-breakdown"');
    expect(source).toContain("ExternalMatchBreakdown");
    expect(source).toContain("d.externalJobs.matchBreakdownTab");
  });

  it("keeps the existing three tools, in order, ahead of it", () => {
    const source = code(TOOLS);
    const order = ["why-match", "cover-letter", "interview-prep", "match-breakdown"].map(
      (id) => source.indexOf(`id: "${id}"`),
    );
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it("generates nothing on render, on drawer open, or on tab select", () => {
    const source = code(FEATURE);
    // An effect is how "generate on mount" returns, and selecting the tab
    // mounts this panel.
    expect(source).not.toContain("useEffect");
    expect(source).toContain("onClick={generate}");
    expect(code(TOOLS)).not.toContain("useEffect");
  });

  it("no search or list surface reaches the generator", () => {
    const surfaces = readdirSync(join(ROOT, "components/external"))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => `components/external/${file}`);
    for (const file of surfaces) {
      if (file === FEATURE) continue;
      expect(code(file), file).not.toContain("generateMatchBreakdownAction");
    }
    for (const page of [
      "app/(candidate)/external-jobs/page.tsx",
      "app/(candidate)/external-jobs/saved/page.tsx",
      "app/(candidate)/external-jobs/applications/page.tsx",
    ]) {
      expect(code(page), page).not.toMatch(/match-breakdown|MatchBreakdown/);
    }
  });

  it("refuses a second press before a request exists", () => {
    const body = generateBody(code(FEATURE));
    const guardAt = body.indexOf("canStartAiRequest");
    const callAt = body.indexOf("generateMatchBreakdownAction");
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(callAt);
    expect(body).toMatch(/if \(!canStartAiRequest\([^)]*\)\) return;/);
    expect(body).toContain("runLatest");
  });
});

/* -------------------------------------------------------------------------- */

describe("no score is invented anywhere", () => {
  it("the panel and the list do no arithmetic at all", () => {
    for (const file of [FEATURE, LIST]) {
      const source = code(file);
      expect(source, file).not.toContain("Math.");
      // No tallying statuses into a figure.
      expect(source, file).not.toMatch(/\.filter\([^)]*STRONG/);
      expect(source, file).not.toMatch(/reduce\(/);
      // Word-bounded: `AiGenerationState` contains the letters of "ratio",
      // and a guard that fires on a component name teaches people to delete it.
      expect(source, file).not.toMatch(/\bpercent|\bPercent|\bratio\b|\.length \/|\* 100/);
    }
  });

  it("draws no bar, ring or meter", () => {
    // A progress bar is a percentage that happens to be drawn rather than
    // written, and it would sit beside the ranker's real number.
    for (const file of [FEATURE, LIST]) {
      const source = code(file);
      expect(source, file).not.toMatch(/<progress|role="progressbar"|aria-valuenow/);
      expect(source, file).not.toMatch(/strokeDasharray|conic-gradient/);
      expect(source, file).not.toMatch(/w-\[\$\{|style=\{\{\s*width/);
    }
  });

  it("shows no numeric field from the breakdown", () => {
    const source = code(FEATURE);
    for (const forbidden of ["score", "band", "rank", "weight", "rating"]) {
      expect(source.toLowerCase(), `feature renders ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the drawer's deterministic score is still the only number", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("d.externalJobs.scoreValue");
    expect(drawer).toContain("d.externalJobs.scoreNote");
    expect(drawer.indexOf("d.externalJobs.scoreValue")).toBeLessThan(
      drawer.indexOf("<ExternalAiTools"),
    );
  });
});

/* -------------------------------------------------------------------------- */

describe("status is carried by words, and UNKNOWN is not a gap", () => {
  it("renders the status as text from the dictionary", () => {
    const list = code(LIST);
    expect(list).toContain("d.matchBreakdown.status[dimension.status]");
    // Tone comes from the shared table, not from an inline colour decision.
    expect(list).toContain("breakdownStatusTone");
  });

  it("uses no icon or colour as the sole carrier of status", () => {
    const list = code(LIST);
    // No status glyph that would need its own alternative text.
    expect(list).not.toMatch(/status === "STRONG" \?\s*"[^"]/);
    expect(list).not.toMatch(/CheckIcon|AlertIcon|CloseIcon/);
  });

  it("names UNKNOWN as missing information, in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const unknown = dictionary.matchBreakdown.status.UNKNOWN;
      const gap = dictionary.matchBreakdown.status.GAP;
      expect(unknown, locale).toBeTruthy();
      // The two must never read alike — that is the whole distinction.
      expect(unknown, locale).not.toBe(gap);
      // And UNKNOWN must not be worded as a verdict about the reader.
      expect(unknown.toLowerCase(), locale).not.toMatch(/gap|fail|miss|不足함|провал/);
    }
  });

  it("gives all four statuses a label in all four locales", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const status of MATCH_BREAKDOWN_STATUSES) {
        expect(dictionary.matchBreakdown.status[status], `${locale}.${status}`).toBeTruthy();
      }
      // Four distinct labels: two that read alike make the column useless.
      const labels = MATCH_BREAKDOWN_STATUSES.map(
        (status) => dictionary.matchBreakdown.status[status],
      );
      expect(new Set(labels).size, locale).toBe(4);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("evidence lists", () => {
  it("renders matched and missing only when they have items", () => {
    const list = code(LIST);
    expect(list).toContain("dimension.matched.length > 0");
    expect(list).toContain("dimension.missing.length > 0");
  });

  it("hides the whole list when there are no dimensions", () => {
    expect(code(LIST)).toContain("if (dimensions.length === 0) return null");
  });

  it("uses real list semantics for the rows and the evidence", () => {
    const list = code(LIST);
    expect(list.match(/<ul/g) ?? []).toHaveLength(2);
    expect(list.match(/<li/g) ?? []).toHaveLength(2);
  });

  it("gives each dimension a real heading at a nestable level", () => {
    const list = code(LIST);
    expect(list).toContain("headingLevel");
    expect(list).not.toMatch(/<h4 className/);
  });
});

/* -------------------------------------------------------------------------- */

describe("shared behaviour is reused, not reimplemented", () => {
  it("uses the existing panel, state and lifecycle", () => {
    const source = code(FEATURE);
    expect(source).toContain("PremiumAiPanel");
    expect(source).toContain("AiGenerationState");
    expect(source).toContain("aiRequestFor");
    expect(source).toContain("readyAiRequest");
  });

  it("inherits EXTERNAL_AI_SEARCH — no new capability", () => {
    expect(code(FEATURE)).toContain('capability="EXTERNAL_AI_SEARCH"');
    const plan = code("lib/entitlements/plan.ts");
    expect(plan).not.toMatch(/BREAKDOWN|MATCH_BREAKDOWN/);
  });

  it("routes failures through the one shared mapping", () => {
    const actions = code("app/(candidate)/external-jobs/actions.ts");
    expect(actions).toContain("generateMatchBreakdownAction");
    // Still exactly one place that reads a plan refusal, for all four tools.
    expect(actions.match(/planUpgradeFrom\(/g) ?? []).toHaveLength(1);
    expect(actions.match(/premiumAiFailure\(error\)/g) ?? []).toHaveLength(4);
  });

  it("hard-codes no plan literal", () => {
    for (const file of [FEATURE, LIST]) {
      for (const plan of ["FREE", "PRO", "MAX"]) {
        expect(code(file), `${file} hard-codes ${plan}`).not.toMatch(
          new RegExp(`[=!]==\\s*["']${plan}["']`),
        );
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("safety and layout", () => {
  it("renders no raw HTML and runs no markdown", () => {
    for (const file of [FEATURE, LIST]) {
      expect(code(file), file).not.toContain("dangerouslySetInnerHTML");
      expect(code(file), file).not.toMatch(/markdown|remark|marked|DOMPurify/i);
    }
  });

  it("names no model, key or prompt", () => {
    for (const file of [FEATURE, LIST, "lib/ai/match-breakdown.ts"]) {
      /*
       * Raw source, comments included — a key pasted into a comment is still a
       * leaked key. But the MODEL NAME is matched case-sensitively, in its
       * env-var form: `GEMINI_API_KEY` is a credential, whereas a comment
       * explaining that the BACKEND sends prose to Gemini is documentation,
       * and a guard that fails on it just teaches people to stop writing it
       * down.
       */
      expect(read(file), file).not.toMatch(/GEMINI_API|GOOGLE_API|api_?key|apiKey/i);
    }
    const pkg = read("package.json");
    for (const forbidden of ["@google/generative-ai", "@google/genai", "openai"]) {
      expect(pkg, forbidden).not.toContain(forbidden);
    }
  });

  it("wraps long localized text instead of overflowing", () => {
    const list = code(LIST);
    expect(list.match(/break-words/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // The label/badge row wraps rather than crushing the badge.
    expect(list).toContain("flex-wrap");
    expect(list).toContain("min-w-0");
  });

  it("adds no fixed width that could overflow a narrow drawer", () => {
    expect(code(LIST)).not.toMatch(/w-\[\d{3,}px\]|min-w-\[\d{3,}px\]/);
  });
});

/* -------------------------------------------------------------------------- */

describe("the other three tools are untouched", () => {
  it("each still calls its own action", () => {
    for (const [file, action] of [
      ["components/external/ExternalWhyMatch.tsx", "explainExternalMatchAction"],
      ["components/external/ExternalCoverLetter.tsx", "generateCoverLetterAction"],
      ["components/external/ExternalInterviewPrep.tsx", "generateInterviewPrepAction"],
    ] as const) {
      expect(code(file), file).toContain(action);
    }
  });

  it("the tab strip still honours its keyboard contract", () => {
    const tabs = code("components/ai/AiToolTabs.tsx");
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      expect(tabs, key).toContain(key);
    }
    expect(tabs).toContain("tabIndex={selected ? 0 : -1}");
    expect(tabs).toContain('role="tablist"');
  });

  it("saving, tracking, search and ranking are untouched", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("ExternalSaveButton");
    expect(drawer).toContain("ExternalTrackingControl");
    for (const file of [FEATURE, LIST, TOOLS]) {
      const source = code(file);
      for (const forbidden of ["RELEVANCE", "NEWEST", "useRouter", "revalidatePath", "personal"]) {
        expect(source, `${file} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the internal universe free of the external tools", () => {
    for (const file of [
      "components/candidate/JobMatchWorkspace.tsx",
      "components/candidate/MatchCard.tsx",
      "app/(candidate)/job-matches/page.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/MatchBreakdown|match-breakdown/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("localization and the plans page", () => {
  const KEYS = [
    "matchBreakdownTab",
    "matchBreakdownTitle",
    "matchBreakdownInvite",
    "matchBreakdownGenerate",
  ] as const;

  it("has every new string in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of KEYS) {
        expect(dictionary.externalJobs[key], `${locale}.${key}`).toBeTruthy();
      }
      expect(dictionary.matchBreakdown.matched, locale).toBeTruthy();
      expect(dictionary.matchBreakdown.missing, locale).toBeTruthy();
    }
  });

  it("leaks no machine code as user-facing text", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const strings = [
        ...KEYS.map((key) => dictionary.externalJobs[key]),
        dictionary.matchBreakdown.matched,
        dictionary.matchBreakdown.missing,
        ...MATCH_BREAKDOWN_STATUSES.map((s) => dictionary.matchBreakdown.status[s]),
      ];
      for (const value of strings) {
        expect(value, locale).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
        expect(value, locale).not.toContain("undefined");
      }
    }
  });

  it("gives all four tool tabs distinct labels in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const labels = [
        dictionary.externalJobs.whyMatchTitle,
        dictionary.externalJobs.coverLetterTab,
        dictionary.externalJobs.interviewPrepTab,
        dictionary.externalJobs.matchBreakdownTab,
      ];
      expect(new Set(labels).size, locale).toBe(4);
    }
  });

  /**
   * The plans page sells what WORKS — now five tools.
   *
   * The breakdown entry was deliberately withheld while its generation
   * returned AI_MATCH_BREAKDOWN_UNAVAILABLE on every call, because listing it
   * would have sold a paying customer a button that always failed. A real 200
   * with `version: external-match-breakdown-v1` is now confirmed live, so it
   * is listed and asserted here.
   */
  it("lists all five shipped MAX tools, and nothing unshipped", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const features = dictionary.plans.cards.MAX.features.join(" | ").toLowerCase();
      expect(features, `${locale} external search`).toMatch(/search|검색|поиск|qidiruv/);
      expect(features, `${locale} why match`).toMatch(/why this match|왜 이 공고|почему эта|nega bu ish/);
      expect(features, `${locale} cover letter`).toMatch(/cover letter|자기소개서|письма|xat/);
      expect(features, `${locale} interview`).toMatch(/interview|면접|собеседован|suhbat/);
      expect(features, `${locale} breakdown`).toMatch(/breakdown|매칭 상세|разбор|tahlil/);
      // Nothing may be sold as forthcoming, under any wording.
      expect(features, locale).not.toMatch(/coming soon|скоро|곧 출시|tez orada/);
    }
  });
});
