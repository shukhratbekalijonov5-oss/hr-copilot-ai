import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

/**
 * The rules around two more paid, on-demand model calls.
 *
 * Everything the why-match guard protects applies here too, plus two that are
 * specific to these features:
 *
 *   - A "Regenerate" button in front of a backend that always returns its
 *     cache. It would look like a feature and behave like a lie.
 *   - A model-written sample ANSWER in the reader's own voice, or a readiness
 *     score. Somebody who memorised a generated answer about a project they
 *     did not do walks into an interview worse off than if we had shipped
 *     nothing.
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


/** The body of the component's `generate()` function, imports excluded. */
function generateBody(source: string): string {
  const start = source.indexOf("function generate()");
  if (start === -1) return "";
  return source.slice(start);
}

const COVER = "components/external/ExternalCoverLetter.tsx";
const PREP = "components/external/ExternalInterviewPrep.tsx";
const TOOLS = "components/external/ExternalAiTools.tsx";
const FEATURES = [COVER, PREP];
const NEW_PRIMITIVES = [
  "components/ai/AiTextDocument.tsx",
  "components/ai/AiQuestionList.tsx",
  "components/ai/AiCopyButton.tsx",
  "components/ai/AiToolTabs.tsx",
];

/* -------------------------------------------------------------------------- */

describe("nothing generates until its own button is pressed", () => {
  it("no search or list surface reaches either generator", () => {
    const surfaces = readdirSync(join(ROOT, "components/external"))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => `components/external/${file}`);

    for (const file of surfaces) {
      if (FEATURES.includes(file)) continue;
      expect(code(file), file).not.toContain("generateCoverLetterAction");
      expect(code(file), file).not.toContain("generateInterviewPrepAction");
    }
  });

  it("no server page generates one during a render", () => {
    for (const page of [
      "app/(candidate)/external-jobs/page.tsx",
      "app/(candidate)/external-jobs/saved/page.tsx",
      "app/(candidate)/external-jobs/applications/page.tsx",
    ]) {
      expect(code(page), page).not.toMatch(/cover-letter|interview-prep|CoverLetter|InterviewPrep/);
    }
  });

  it("neither panel uses an effect", () => {
    // An effect is exactly how "generate on open" gets reintroduced, and it
    // would fire for every job a reader opens.
    for (const file of FEATURES) {
      expect(code(file), file).not.toContain("useEffect");
      expect(code(file), file).toContain("onClick={generate}");
    }
  });

  it("guards a second press before a request exists", () => {
    for (const [file, action] of [
      [COVER, "generateCoverLetterAction"],
      [PREP, "generateInterviewPrepAction"],
    ] as const) {
      // The generate() body, not the whole file — an import sits above
      // everything and would make this pass while the guard sat after the
      // call, which is the exact bug it exists to catch.
      const body = generateBody(code(file));
      const guardAt = body.indexOf("canStartAiRequest");
      const callAt = body.indexOf(action);

      expect(guardAt, `${file}: no guard in generate()`).toBeGreaterThan(-1);
      expect(callAt, `${file}: no call in generate()`).toBeGreaterThan(-1);
      expect(guardAt, file).toBeLessThan(callAt);
      // And it returns rather than merely noting the result.
      expect(body, file).toMatch(/if \(!canStartAiRequest\([^)]*\)\) return;/);
      expect(body, file).toContain("runLatest");
    }
  });

  it("opening the tools area starts nothing at all", () => {
    // The strip holds no request and calls no action, which is what makes it
    // safe to put paid generations behind tabs a reader clicks around in.
    const source = code(TOOLS);
    expect(source).not.toContain("useEffect");
    expect(source).not.toMatch(/generate|explain/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("no fabricated claims about the reader", () => {
  it("the prep panel offers questions, never answers or a score", () => {
    const source = code(PREP);
    for (const forbidden of ["answer", "score", "readiness", "confidence", "percent"]) {
      expect(source.toLowerCase(), `prep mentions ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("neither panel computes anything about the candidate", () => {
    for (const file of [...FEATURES, ...NEW_PRIMITIVES]) {
      expect(code(file), file).not.toContain("Math.");
      expect(code(file), file).not.toMatch(/yearsOf|experienceYears|estimate/i);
    }
  });

  it("renders only what the backend sent", () => {
    // No default, placeholder or filler text standing in for a missing field.
    for (const file of NEW_PRIMITIVES) {
      expect(code(file), file).not.toMatch(/\?\?\s*"[A-Za-z]{4,}/);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("no regenerate button in front of a cache", () => {
  it("the cover letter offers Copy after success, never Regenerate", () => {
    const source = code(COVER);
    expect(source).toContain("AiCopyButton");
    expect(source.toLowerCase()).not.toContain("regenerate");
    // `canStartAiRequest` refuses a repeat once the letter is ready, so even a
    // stray call could not re-request it.
    expect(source).toContain("canStartAiRequest");
  });

  it("try-again exists only on failure, via the shared state component", () => {
    for (const file of FEATURES) {
      expect(code(file), file).toContain("AiGenerationState");
      expect(code(file), file).toContain("onRetry={generate}");
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("copying is honest about failure", () => {
  it("routes through the guarded helper rather than the raw API", () => {
    const button = code("components/ai/AiCopyButton.tsx");
    expect(button).toContain("copyToClipboard");
    // A bare `navigator.clipboard.writeText(...)` would report success for a
    // write the browser refused.
    expect(button).not.toMatch(/navigator\.clipboard\.writeText/);
  });

  it("announces the outcome instead of only swapping an icon", () => {
    const button = code("components/ai/AiCopyButton.tsx");
    expect(button).toContain('aria-live="polite"');
    expect(button).toContain("d.premiumAi.copyFailed");
    expect(button).toContain("aria-label");
  });

  it("keeps the text on screen so it can be selected by hand", () => {
    // The letter is never hidden behind the copy button, because the clipboard
    // being unavailable is ordinary rather than exotic.
    const doc = code("components/ai/AiTextDocument.tsx");
    expect(doc).not.toContain("sr-only");
    expect(doc).not.toContain("hidden");
  });
});

/* -------------------------------------------------------------------------- */

describe("generated content is text, never markup", () => {
  it("uses no raw-HTML escape hatch and no markdown pass", () => {
    for (const file of [...FEATURES, ...NEW_PRIMITIVES, TOOLS]) {
      expect(code(file), file).not.toContain("dangerouslySetInnerHTML");
      expect(code(file), file).not.toContain("innerHTML");
      expect(code(file), file).not.toMatch(/markdown|remark|marked|DOMPurify/i);
    }
  });

  it("splits letter paragraphs without interpreting them", () => {
    const doc = code("components/ai/AiTextDocument.tsx");
    expect(doc).toContain("split(");
    expect(doc).toContain("whitespace-pre-line");
  });
});

/* -------------------------------------------------------------------------- */

describe("the frontend still never talks to a model", () => {
  it("ships no model client or key", () => {
    const pkg = read("package.json");
    for (const forbidden of ["@google/generative-ai", "@google/genai", "openai", "googleapis"]) {
      expect(pkg, `package.json depends on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("builds no prompt and names no credential", () => {
    for (const file of [...FEATURES, ...NEW_PRIMITIVES, TOOLS]) {
      expect(read(file), file).not.toMatch(/GEMINI|GOOGLE_API|api_?key|apiKey/i);
      expect(code(file), file).not.toMatch(/temperature|maxTokens|systemPrompt/i);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("entitlement stays centralized", () => {
  it("no plan literal in either feature or any new primitive", () => {
    for (const file of [...FEATURES, ...NEW_PRIMITIVES, TOOLS]) {
      for (const plan of ["FREE", "PRO", "MAX"]) {
        expect(code(file), `${file} hard-codes ${plan}`).not.toMatch(
          new RegExp(`[=!]==\\s*["']${plan}["']`),
        );
      }
    }
  });

  it("both tools inherit EXTERNAL_AI_SEARCH — no new capability invented", () => {
    for (const file of FEATURES) {
      expect(code(file), file).toContain('capability="EXTERNAL_AI_SEARCH"');
    }
    // And the shared resolver still knows exactly two capabilities.
    const plan = code("lib/entitlements/plan.ts");
    expect(plan).toContain("INTERNAL_AI_SEARCH");
    expect(plan).toContain("EXTERNAL_AI_SEARCH");
    expect(plan).not.toMatch(/COVER_LETTER|INTERVIEW_PREP/);
  });

  it("one shared failure mapping serves all three tools", () => {
    // Three copies would drift, and the drift would be invisible: one tool
    // showing an error for a refusal another correctly renders as a paywall.
    const actions = code("app/(candidate)/external-jobs/actions.ts");
    expect(actions).toContain("premiumAiFailure");
    expect(actions.match(/planUpgradeFrom\(/g) ?? []).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe("the tools strip is keyboard-operable and extensible", () => {
  const tabs = code("components/ai/AiToolTabs.tsx");

  it("honours the tab role it claims", () => {
    // Taking role="tablist" without arrow keys is worse than not claiming it:
    // a screen reader tells the user to press Right and nothing happens.
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain('role="tabpanel"');
    expect(tabs).toContain("ArrowRight");
    expect(tabs).toContain("ArrowLeft");
    expect(tabs).toContain("Home");
    expect(tabs).toContain("End");
  });

  it("uses a roving tabindex and links tab to panel", () => {
    expect(tabs).toContain("tabIndex={selected ? 0 : -1}");
    expect(tabs).toContain("aria-selected");
    expect(tabs).toContain("aria-controls");
    expect(tabs).toContain("aria-labelledby");
  });

  it("keeps a visible focus ring and scrolls rather than wrapping", () => {
    expect(tabs).toContain("focus-visible:");
    expect(tabs).toContain("overflow-x-auto");
    expect(tabs).toContain("whitespace-nowrap");
  });

  it("takes its tools as data, so a fourth is one array entry", () => {
    // This is what makes Advanced Match Breakdown a change to ExternalAiTools
    // alone rather than a redesign.
    expect(tabs).toContain("tools: AiTool[]");
    expect(tabs).toContain("tools.map");
    expect(code(TOOLS)).toContain("const tools: AiTool[]");
  });

  it("exposes no unfinished tool", () => {
    /*
     * Advanced Match Breakdown shipped, so its absence is no longer the test.
     * The rule that outlasts it: every tab in the strip is a real, working
     * panel. An inert or "coming soon" entry teaches a reader to ignore the
     * strip, which costs the tools that DO work.
     */
    const source = code(TOOLS);
    expect(source).not.toMatch(/coming soon/i);
    expect(source).not.toContain("disabled");

    // Every declared tool has a panel, and every panel is a real component.
    const ids = source.match(/id: "([a-z-]+)"/g) ?? [];
    const panels = source.match(/panel: <External\w+/g) ?? [];
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(panels).toHaveLength(ids.length);
  });
});

/* -------------------------------------------------------------------------- */

describe("layout survives long localized text", () => {
  it("wraps rather than widening", () => {
    for (const file of [
      "components/ai/AiTextDocument.tsx",
      "components/ai/AiQuestionList.tsx",
    ]) {
      expect(code(file), file).toContain("break-words");
    }
  });

  it("hides a question or focus list with nothing in it", () => {
    expect(code("components/ai/AiQuestionList.tsx")).toContain(
      "if (questions.length === 0) return null",
    );
    expect(code("components/ai/AiInsightList.tsx")).toContain(
      "if (items.length === 0) return null",
    );
  });

  it("gives questions ordered-list semantics with per-question notes", () => {
    const list = code("components/ai/AiQuestionList.tsx");
    expect(list).toContain("<ol");
    expect(list).toContain("<li");
    // Why-asked and how-to-prepare are a description list, not a run-on
    // paragraph — which is what lets a reader move question by question.
    expect(list).toContain("<dl");
    expect(list).toContain("<dt");
    expect(list).toContain("<dd");
  });
});

/* -------------------------------------------------------------------------- */

describe("every new string exists in all four locales", () => {
  const EXTERNAL_KEYS = [
    "aiToolsTitle",
    "coverLetterTab",
    "coverLetterTitle",
    "coverLetterInvite",
    "coverLetterGenerate",
    "coverLetterSubject",
    "coverLetterCopyLabel",
    "interviewPrepTab",
    "interviewPrepTitle",
    "interviewPrepInvite",
    "interviewPrepGenerate",
    "interviewQuestions",
    "interviewFocusAreas",
  ] as const;
  const PREMIUM_KEYS = [
    "copy",
    "copied",
    "copyFailed",
    "questionNumber",
    "whyAsked",
    "howToPrepare",
  ] as const;

  it("has every string", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of EXTERNAL_KEYS) {
        expect(dictionary.externalJobs[key], `${locale}.${key}`).toBeTruthy();
      }
      for (const key of PREMIUM_KEYS) {
        expect(dictionary.premiumAi[key], `${locale}.premiumAi.${key}`).toBeTruthy();
      }
    }
  });

  it("leaks no machine code as user-facing text", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const strings = [
        ...EXTERNAL_KEYS.map((key) => dictionary.externalJobs[key]),
        ...PREMIUM_KEYS.map((key) => dictionary.premiumAi[key]),
      ];
      for (const value of strings) {
        expect(value, locale).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
        expect(value, locale).not.toContain("undefined");
      }
    }
  });

  it("keeps the {number} placeholder the question label needs", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.premiumAi.questionNumber, locale).toContain("{number}");
    }
  });

  it("gives the three tools distinct labels in every locale", () => {
    // Two tabs reading identically would make the strip unusable in that
    // language while passing every other check.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const labels = [
        dictionary.externalJobs.whyMatchTitle,
        dictionary.externalJobs.coverLetterTab,
        dictionary.externalJobs.interviewPrepTab,
      ];
      expect(new Set(labels).size, locale).toBe(3);
    }
  });

  it("lists both shipped tools on MAX, and no unshipped one", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const features = dictionary.plans.cards.MAX.features.join(" | ");
      expect(features.toLowerCase(), locale).toMatch(/cover letter|자기소개서|письма|xat/);
      expect(features.toLowerCase(), locale).toMatch(/interview|면접|собеседован|suhbat/);
      // Advanced Match Breakdown has since shipped; that it IS listed is
      // asserted in match-breakdown-boundary.test.ts. The enduring rule is
      // that nothing may be advertised before it works.
      expect(features, locale).not.toMatch(/coming soon/i);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("why this match, and the rest of external jobs, are unchanged", () => {
  it("the explanation panel still exists and is still the first tool", () => {
    const source = code(TOOLS);
    expect(source).toContain("ExternalWhyMatch");
    expect(source.indexOf("why-match")).toBeLessThan(source.indexOf("cover-letter"));
    expect(code("components/external/ExternalWhyMatch.tsx")).toContain(
      "explainExternalMatchAction",
    );
  });

  it("the drawer still shows the ranker's score, note and reasons above the tools", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("d.externalJobs.scoreValue");
    expect(drawer).toContain("d.externalJobs.scoreNote");
    expect(drawer.indexOf("externalReasonLines")).toBeLessThan(
      drawer.indexOf("<ExternalAiTools"),
    );
  });

  it("saving and tracking still live on their own controls", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("ExternalSaveButton");
    expect(drawer).toContain("ExternalTrackingControl");
    for (const file of [...FEATURES, TOOLS]) {
      expect(code(file), file).not.toContain("personal");
    }
  });

  it("no tool touches search, sort, pagination or navigation", () => {
    for (const file of [...FEATURES, TOOLS]) {
      const source = code(file);
      for (const forbidden of ["RELEVANCE", "NEWEST", "useRouter", "revalidatePath", "refresh()"]) {
        expect(source, `${file} touches ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("keeps the internal universe free of external AI tools", () => {
    for (const file of [
      "components/candidate/JobMatchWorkspace.tsx",
      "components/candidate/MatchCard.tsx",
      "app/(candidate)/job-matches/page.tsx",
    ]) {
      expect(code(file), file).not.toMatch(/ExternalAiTools|CoverLetter|InterviewPrep/);
      expect(code(file), file).not.toMatch(/cover-letter|interview-prep/);
    }
  });
});
