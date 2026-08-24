import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";

/**
 * The rules around a paid, on-demand model call that no unit test can protect.
 *
 * Each of these breaks in a way that looks like an improvement in a diff:
 *
 *   - Prefetching the explanation so it "feels instant" — twenty model calls
 *     per search, paid in latency by a reader who scrolled past nineteen.
 *   - Rendering the model's prose as markdown so it "looks nicer" — arbitrary
 *     generated output interpreted as markup.
 *   - Showing a Retry beside the paywall for consistency with the other error
 *     states — a button that is guaranteed to fail, forever.
 *   - Adding a generated percentage next to the deterministic score.
 *
 * So these read the source and fail loudly enough that the next person has to
 * come and read why.
 */

const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Source with comments stripped, so prose about a rule cannot satisfy it. */
function code(path: string): string {
  return read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FEATURE = "components/external/ExternalWhyMatch.tsx";
const PRIMITIVES = [
  "components/ai/PremiumAiPanel.tsx",
  "components/ai/AiGenerationState.tsx",
  "components/ai/AiInsightList.tsx",
  "components/ai/AiSummary.tsx",
];
const EXTERNAL_SURFACES = readdirSync(join(ROOT, "components/external"))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => `components/external/${file}`);

/* -------------------------------------------------------------------------- */

describe("nothing is generated until somebody asks", () => {
  it("no search or list surface requests an explanation", () => {
    // The card, the workspace, the saved list and the tracked list must never
    // reach the generation action. Only the drawer's panel does.
    for (const file of EXTERNAL_SURFACES) {
      if (file === FEATURE) continue;
      expect(code(file), file).not.toContain("explainExternalMatchAction");
      expect(code(file), file).not.toContain("explainExternalMatch");
    }
  });

  it("no server page generates one during a render", () => {
    for (const page of [
      "app/(candidate)/external-jobs/page.tsx",
      "app/(candidate)/external-jobs/saved/page.tsx",
      "app/(candidate)/external-jobs/applications/page.tsx",
    ]) {
      expect(code(page), page).not.toContain("explainExternalMatch");
      expect(code(page), page).not.toContain("why-match");
    }
  });

  it("the panel starts a generation only from a click handler", () => {
    const source = code(FEATURE);
    // No effect anywhere in this component: an effect is precisely how "fetch
    // on open" gets reintroduced, and it would fire for every job a reader
    // opens rather than for the ones they ask about.
    expect(source).not.toContain("useEffect");
    expect(source).toContain("onClick={generate}");
  });

  it("guards the second press before a request exists", () => {
    const source = code(FEATURE);
    const generateBody = source.slice(
      source.indexOf("function generate()"),
      source.indexOf("const explanation"),
    );
    const guardAt = generateBody.indexOf("canStartAiRequest");
    const callAt = generateBody.indexOf("explainExternalMatchAction");
    expect(guardAt).toBeGreaterThan(-1);
    // Ordering is the guarantee: a check after the call would still have made
    // the call.
    expect(guardAt).toBeLessThan(callAt);
    expect(source).toContain("runLatest");
  });
});

/* -------------------------------------------------------------------------- */

describe("the frontend never talks to a model", () => {
  it("ships no model client, SDK or key", () => {
    const pkg = read("package.json");
    for (const forbidden of [
      "@google/generative-ai",
      "@google/genai",
      "googleapis",
      "openai",
      "@anthropic-ai/sdk",
    ]) {
      expect(pkg, `package.json depends on ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("references no model endpoint or credential anywhere in the feature", () => {
    for (const file of [FEATURE, ...PRIMITIVES, "lib/api/external-jobs.service.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/generativelanguage\.googleapis|api_?key|apiKey/i);
      expect(source, file).not.toMatch(/GEMINI|GOOGLE_API/);
    }
  });

  it("builds no prompt in the browser", () => {
    // The backend owns the prompt, the model, the cache and the rate limit.
    // A prompt assembled here would also mean the candidate's evidence
    // travelling from the browser to build it.
    const source = code(FEATURE);
    expect(source).not.toMatch(/prompt|system\s*:|temperature|maxTokens/i);
  });
});

/* -------------------------------------------------------------------------- */

describe("model output is text, never markup", () => {
  it("uses no raw-HTML escape hatch", () => {
    for (const file of [FEATURE, ...PRIMITIVES]) {
      expect(code(file), file).not.toContain("dangerouslySetInnerHTML");
      expect(code(file), file).not.toContain("innerHTML");
    }
  });

  it("runs no markdown or sanitizer pass over it", () => {
    // Plain structured text is the design. A sanitizer would imply markup was
    // being rendered and merely cleaned first, which is a much harder promise.
    for (const file of [FEATURE, ...PRIMITIVES]) {
      expect(code(file), file).not.toMatch(/markdown|remark|marked|sanitize|DOMPurify/i);
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the deterministic score is untouched", () => {
  it("the panel computes, formats and shows no score of any kind", () => {
    const source = code(FEATURE);
    for (const forbidden of ["job.score", "score={", "band", "percent", "Math."]) {
      expect(source, `feature references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the drawer still renders the ranker's score, note and reasons", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("d.externalJobs.scoreValue");
    // The sentence that says a score measures the search and not the reader's
    // chances must survive — it is what stops the number reading as odds.
    expect(drawer).toContain("d.externalJobs.scoreNote");
    expect(drawer).toContain("externalReasonLines");
  });

  it("puts the generated panel BELOW the computed score and reasons", () => {
    // Fluent prose above the computed facts would make the facts look like
    // supporting detail for the prose. The relationship runs the other way.
    //
    // The explanation now lives inside the AI Tools strip, which is where the
    // ordering is enforced — the strip as a whole sits below the score.
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    const toolsAt = drawer.indexOf("<ExternalAiTools");
    expect(toolsAt, "the AI tools are no longer mounted in the drawer").toBeGreaterThan(-1);
    expect(drawer.indexOf("d.externalJobs.scoreValue")).toBeLessThan(toolsAt);
    expect(drawer.indexOf("externalReasonLines")).toBeLessThan(toolsAt);
    // And the explanation is still the first tool in that strip.
    expect(code("components/external/ExternalAiTools.tsx")).toContain("ExternalWhyMatch");
  });
});

/* -------------------------------------------------------------------------- */

describe("four outcomes, four screens", () => {
  const state = code("components/ai/AiGenerationState.tsx");

  it("renders the paywall for a plan refusal, not an error box", () => {
    expect(state).toContain("PlanLockedCard");
    const planAt = state.indexOf('status === "plan_required"');
    const errorAt = state.indexOf('status === "gone"');
    expect(planAt).toBeGreaterThan(-1);
    expect(planAt).toBeLessThan(errorAt);
  });

  it("offers no retry for a plan refusal or a vanished job", () => {
    // The retry is gated on `isRetryable`, which is false for both — asserted
    // directly in premium-request.test.ts.
    expect(state).toContain("isRetryable(status)");
    const planBranch = state.slice(
      state.indexOf('status === "plan_required"'),
      state.indexOf('status === "gone"'),
    );
    expect(planBranch).not.toContain("onRetry");
  });

  it("distinguishes unavailable, gone and generic failure in copy", () => {
    for (const key of ["jobGone", "unavailable", "failed"]) {
      expect(state, key).toContain(`d.premiumAi.${key}`);
    }
  });

  it("never presents work-in-progress as a failure", () => {
    const loading = state.slice(
      state.indexOf('status === "loading"'),
      state.indexOf('status === "plan_required"'),
    );
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("d.premiumAi.generating");
    expect(loading).not.toContain("AlertIcon");
  });
});

/* -------------------------------------------------------------------------- */

describe("entitlement logic stays centralized", () => {
  it("no plan literal in the feature or its primitives", () => {
    for (const file of [FEATURE, ...PRIMITIVES]) {
      for (const plan of ["FREE", "PRO", "MAX"]) {
        expect(code(file), `${file} hard-codes ${plan}`).not.toMatch(
          new RegExp(`[=!]==\\s*["']${plan}["']`),
        );
      }
    }
  });

  it("the paywall comes from the shared resolver, not a local check", () => {
    expect(code("components/ai/AiGenerationState.tsx")).toContain("requiredPlanFor");
    expect(code(FEATURE)).toContain('capability="EXTERNAL_AI_SEARCH"');
  });

  it("the backend's refusal is what triggers it", () => {
    // Not a local `plan === MAX` test: a plan that lapsed mid-session, or a
    // capability the backend splits out later, resolves correctly only here.
    expect(code("app/(candidate)/external-jobs/actions.ts")).toContain("planUpgradeFrom");
  });
});

/* -------------------------------------------------------------------------- */

describe("accessibility and layout", () => {
  it("gives strengths and gaps real list semantics", () => {
    const list = code("components/ai/AiInsightList.tsx");
    expect(list).toContain("<ul");
    expect(list).toContain("<li");
    // The ✓ / △ are decoration over a heading that already names the list.
    expect(list).toContain('aria-hidden="true"');
    expect(list).toContain("sr-only");
  });

  it("hides a list with nothing in it", () => {
    expect(code("components/ai/AiInsightList.tsx")).toContain(
      "if (items.length === 0) return null",
    );
  });

  it("keeps the heading outline nestable rather than fixed", () => {
    const panel = code("components/ai/PremiumAiPanel.tsx");
    expect(panel).toContain("headingLevel");
    expect(panel).not.toMatch(/<h3 className/);
  });

  it("uses a real button with a focus ring, not a fake anchor", () => {
    const source = code(FEATURE);
    expect(source).toContain("<Button");
    expect(source).not.toContain("aria-disabled");
    // The shared Button carries focus-visible styling for every consumer.
    expect(code("components/ui/Button.tsx")).toContain("focus-visible:");
  });

  it("wraps long localized text instead of widening the drawer", () => {
    for (const file of [
      "components/ai/AiInsightList.tsx",
      "components/ai/AiSummary.tsx",
    ]) {
      expect(code(file), file).toContain("break-words");
    }
    // The panel's header wraps rather than crushing the action control.
    expect(code("components/ai/PremiumAiPanel.tsx")).toContain("flex-wrap");
    expect(code("components/ai/PremiumAiPanel.tsx")).toContain("min-w-0");
  });

  it("keeps the error row stacked on narrow widths", () => {
    expect(code("components/ai/AiGenerationState.tsx")).toContain("sm:flex-row");
  });
});

/* -------------------------------------------------------------------------- */

describe("every string is translated, in all four locales", () => {
  const KEYS = [
    "whyMatchTitle",
    "whyMatchInvite",
    "whyMatchGenerate",
    "whyMatchStrengths",
    "whyMatchGaps",
  ] as const;
  const PREMIUM_KEYS = [
    "disclaimer",
    "generating",
    "tryAgain",
    "unavailable",
    "failed",
    "jobGone",
    "strengthLabel",
    "gapLabel",
  ] as const;

  it("has every why-match and premium string", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of KEYS) {
        expect(dictionary.externalJobs[key], `${locale}.${key}`).toBeTruthy();
      }
      for (const key of PREMIUM_KEYS) {
        expect(dictionary.premiumAi[key], `${locale}.premiumAi.${key}`).toBeTruthy();
      }
    }
  });

  it("leaks no machine code as user-facing text", () => {
    // A reader must never be shown PLAN_UPGRADE_REQUIRED, a capability name,
    // or a screaming-snake error code.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const strings = [
        ...KEYS.map((key) => dictionary.externalJobs[key]),
        ...PREMIUM_KEYS.map((key) => dictionary.premiumAi[key]),
      ];
      for (const value of strings) {
        expect(value, locale).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
        expect(value, locale).not.toContain("undefined");
      }
    }
  });

  it("says the text was AI-written, in every locale", () => {
    // The disclaimer is not optional decoration: generated prose about
    // somebody's own prospects reads as authoritative precisely because it is
    // fluent and sits inside a product that also shows them facts.
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.premiumAi.disclaimer.length, locale).toBeGreaterThan(30);
      expect(dictionary.premiumAi.disclaimer, locale).toMatch(/AI|ИИ/);
    }
  });

  it("advertises Why This Match on the MAX plan, in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      const features = dictionary.plans.cards.MAX.features;
      expect(features.length, locale).toBeGreaterThan(3);
      /*
       * Shipped features only. Cover letter, interview prep and the advanced
       * match breakdown were all unshipped when this guard was written and are
       * now real, so the assertion that they ARE listed lives in
       * `match-breakdown-boundary.test.ts`. What survives here is the rule that
       * outlasts any particular feature: nothing may be sold as forthcoming.
       */
      for (const unshipped of [/coming soon/i]) {
        for (const feature of features) {
          expect(feature, `${locale} advertises an unshipped feature`).not.toMatch(unshipped);
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

describe("the rest of external jobs is unchanged", () => {
  it("search, sort and pagination are untouched by this feature", () => {
    const source = code(FEATURE);
    for (const forbidden of ["RELEVANCE", "NEWEST", "sort", "page", "router", "revalidate"]) {
      expect(source, `feature touches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("generating does not refetch the search or reset the list", () => {
    const source = code(FEATURE);
    expect(source).not.toContain("useRouter");
    expect(source).not.toContain("refresh()");
    expect(source).not.toContain("revalidatePath");
  });

  it("saving and tracking still live on their own controls", () => {
    const drawer = code("components/external/ExternalJobDetailDrawer.tsx");
    expect(drawer).toContain("ExternalSaveButton");
    expect(drawer).toContain("ExternalTrackingControl");
    // And this feature touches neither.
    expect(code(FEATURE)).not.toContain("personal");
  });

  it("keeps the internal and external universes separate", () => {
    // The explanation is an EXTERNAL feature. Nothing about it may appear in
    // the internal match UI. The internal page has its own deterministic
    // "why this ranks here" copy, so this protects only the model-backed
    // external generation path.
    for (const file of [
      "components/candidate/JobMatchWorkspace.tsx",
      "components/candidate/MatchCard.tsx",
      "app/(candidate)/job-matches/page.tsx",
    ]) {
      expect(code(file), file).not.toContain("ExternalWhyMatch");
      expect(code(file), file).not.toContain("explainExternalMatch");
      expect(code(file), file).not.toContain("/why-match");
    }
  });
});
