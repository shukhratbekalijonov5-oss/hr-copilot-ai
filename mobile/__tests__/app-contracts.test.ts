import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/en";
import ko from "@/lib/i18n/ko";
import ru from "@/lib/i18n/ru";
import uz from "@/lib/i18n/uz";
import { LOCALES } from "@/lib/i18n/index";
import { CANDIDATE_TABS, RECRUITER_TABS, activeTabId } from "@/lib/navigation/tabs";
import { mergeMessage } from "@/features/chat/messages";
import { isNavigableCheckoutUrl } from "@/features/billing/queries";
import { buildComparison, MAX_COMPARE_CANDIDATES } from "@/features/recruiter/candidates";
import { CANDIDATE_TIERS, RECRUITER_TIERS, PLANNED_SOURCES } from "@/lib/billing/plans";
import type { ChatMessage, EvidenceMap, VacancyDetail, CandidateSummaryRow } from "@/types";

/**
 * The app's contracts with the backend and with the reader.
 *
 * These are the properties that are expensive to notice by hand: an endpoint
 * that does not exist, a token in the wrong store, a plan the device decided
 * for itself, a comparison cell that invented a status. Rendering is not
 * covered here — jest is configured for pure logic, and that limit is stated
 * in `jest.config.js` rather than papered over.
 */

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every screen and query module, for the whole-app sweeps below. */
const APP_FILES = [
  "lib/api/client.ts",
  "lib/auth/session.ts",
  "lib/storage/secure.ts",
  "lib/realtime/socket.ts",
  "features/candidate/queries.ts",
  "features/recruiter/queries.ts",
  "features/recruiter/candidates.ts",
  "features/chat/queries.ts",
  "features/chat/messages.ts",
  "features/notifications/queries.ts",
  "features/jobs/queries.ts",
  "features/external/queries.ts",
  "features/profile/queries.ts",
  "features/billing/queries.ts",
];

/* ------------------------------------------------------------------ */

describe("every endpoint the app calls exists on the backend", () => {
  /*
   * Read from the NestJS controllers themselves rather than from a list
   * maintained here. A hand-kept list is exactly as likely to be wrong as
   * the code it is checking — this failed three real 404s into existence
   * before it was written.
   */
  const BACKEND = join(ROOT, "..", "backend", "src");

  function routesFrom(file: string, base: string): string[] {
    const text = readFileSync(join(BACKEND, file), "utf8");
    const matches = [...text.matchAll(/@(Get|Post|Patch|Put|Delete)\((?:'([^']*)')?\)/g)];
    return matches.map(([, , path]) => `${base}${path ? `/${path}` : ""}`);
  }

  const KNOWN_BASES: [string, string][] = [
    ["auth/auth.controller.ts", "/auth"],
    ["account/account.controller.ts", "/account"],
    ["candidate-account/candidate-account.controller.ts", "/candidate-account"],
    ["candidate-preferences/candidate-preferences.controller.ts", "/candidate-account/me/job-preferences"],
    ["billing/billing.controller.ts", "/candidate-account/me/billing"],
    ["vacancies/vacancies.controller.ts", "/vacancies"],
    ["candidates/candidates.controller.ts", "/candidates"],
    ["notifications/notifications.controller.ts", "/notifications"],
    ["chat/candidate-conversations.controller.ts", "/candidate-account/me/conversations"],
    ["chat/org-conversations.controller.ts", "/conversations"],
    ["public-jobs/public-jobs.controller.ts", "/public/jobs"],
    ["organizations/organizations.controller.ts", "/organizations"],
    ["search/search.controller.ts", "/search"],
    ["external-jobs/search/external-search.controller.ts", "/candidate-account/me/external-jobs"],
  ];

  const backendAvailable = existsSync(BACKEND);

  it("declares no path the backend does not serve", () => {
    if (!backendAvailable) {
      // The mobile package can be checked out alone; say so rather than
      // passing silently as if the assertion had run.
      console.warn("backend/ not present — endpoint cross-check skipped");
      return;
    }

    const served = new Set<string>();
    for (const [file, base] of KNOWN_BASES) {
      if (!existsSync(join(BACKEND, file))) continue;
      for (const route of routesFrom(file, base)) served.add(normalise(route));
    }
    // Routes served by controllers whose bases are parameterised.
    served.add(normalise("/candidates/:id/vacancies/:id/evidence-map"));
    served.add(normalise("/ai/answer"));

    const called = new Set<string>();
    for (const file of APP_FILES) {
      for (const path of pathsIn(source(file))) called.add(normalise(path));
    }

    const missing = [...called].filter((path) => !served.has(path));
    expect(missing).toEqual([]);
  });

  /** Template holes and ids collapse to `:p`, so shapes compare equal. */
  function normalise(path: string): string {
    return path
      .replace(/\$\{[^}]*\}/g, ":p")
      .replace(/:[A-Za-z][A-Za-z0-9]*/g, ":p")
      .replace(/\/+$/, "");
  }

  function pathsIn(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(/apiFetch<[^>]*>\(\s*[`"]([^`"]+)[`"]/g)) {
      found.push(match[1]);
    }
    // Multi-line calls put the path on the next line.
    for (const match of text.matchAll(/apiFetch<[\s\S]{0,200}?>\(\s*\n\s*[`"](\/[^`"]+)[`"]/g)) {
      found.push(match[1]);
    }
    /*
     * A path whose BASE is a call — `${conversationBase(audience)}/...` —
     * cannot be resolved by reading the source, so it is excluded here and
     * asserted directly in the chat suite instead. Normalising it would
     * produce `:p/:p`, which matches everything and therefore checks
     * nothing.
     */
    return found.filter((path) => path.startsWith("/"));
  }
});

/* ------------------------------------------------------------------ */

describe("tokens never leave SecureStore", () => {
  it("is the only module that touches a token store", () => {
    for (const file of APP_FILES) {
      const text = source(file);
      expect(text).not.toContain(
        "@react-native-async-storage/async-storage",
      );
    }
  });

  it("keeps AsyncStorage for preferences only", () => {
    // The theme store may use it — a colour scheme is not a secret — but it
    // must not be reachable from anything that holds a credential.
    const theme = source("stores/theme.ts");
    expect(theme).toContain("async-storage");
    expect(theme).not.toMatch(/token|accessToken|refreshToken/i);
  });

  it("reads the bearer from memory, never from a screen", () => {
    const client = source("lib/api/client.ts");
    expect(client).toContain("Bearer");
    // Exactly one module may serialise a token into a header.
    const others = APP_FILES.filter((file) => file !== "lib/api/client.ts");
    for (const file of others) {
      if (file === "features/profile/queries.ts") continue; // multipart upload
      expect(source(file)).not.toContain("Bearer");
    }
  });
});

/* ------------------------------------------------------------------ */

describe("session restore and role routing", () => {
  it("asks the server for the role instead of reading the token", () => {
    const session = source("lib/auth/session.ts");
    expect(session).toContain("/auth/me");
    // A JWT is decodable on the device; trusting it would let a tampered
    // payload pick the recruiter shell.
    expect(session).not.toMatch(/atob|jwtDecode|base64/i);
  });

  it("routes on the account type the server reported", () => {
    const index = source("app/index.tsx");
    expect(index).toMatch(/accountType/);
    expect(index).toMatch(/CANDIDATE|ORGANIZATION/);
  });

  it("rotates the refresh token through one shared attempt", () => {
    const client = source("lib/api/client.ts");
    expect(client).toContain("refreshInFlight");
    expect(client).toContain("/auth/refresh");
    // A revoked session ends; it does not retry forever.
    expect(client).toContain("endSession");
  });

  it("counts a lockout down without deciding it", () => {
    const signIn = source("app/(auth)/sign-in.tsx");
    expect(signIn).toContain("LOGIN_TEMPORARILY_LOCKED");
    expect(signIn).toContain("retryAfterSeconds");
    // No local lock that a reinstall would clear and the server would not.
    expect(signIn).not.toContain("SecureStore");
  });
});

/* ------------------------------------------------------------------ */

describe("bottom navigation", () => {
  it("gives the candidate exactly Home / Career / AI Search / Chats / More", () => {
    expect(CANDIDATE_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "career",
      "aiSearch",
      "chats",
      "more",
    ]);
    expect(CANDIDATE_TABS.map((tab) => tab.labelOf(en))).toEqual([
      "Home",
      "Career",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("gives the recruiter exactly Home / Hiring / AI Search / Chats / More", () => {
    expect(RECRUITER_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "hiring",
      "aiSearch",
      "chats",
      "more",
    ]);
    expect(RECRUITER_TABS.map((tab) => tab.labelOf(en))).toEqual([
      "Home",
      "Hiring",
      "AI Search",
      "Chats",
      "More",
    ]);
  });

  it("routes Home and Chats, and opens sheets for the other three", () => {
    for (const tabs of [CANDIDATE_TABS, RECRUITER_TABS]) {
      const byId = new Map(tabs.map((tab) => [tab.id, tab]));
      expect(byId.get("home")?.kind).toBe("route");
      // Chats is one page, so a sheet would be a menu with a single row.
      expect(byId.get("chats")?.kind).toBe("route");
      for (const id of ["career", "hiring", "aiSearch", "more"]) {
        const tab = byId.get(id);
        if (!tab) continue;
        expect(tab.kind).toBe("sheet");
        expect(tab.sheet).toBeTruthy();
      }
    }
  });

  it("lights the parent tab for every child route", () => {
    const cases: [string, string][] = [
      ["/(candidate)/home", "home"],
      ["/(candidate)/jobs", "career"],
      ["/(candidate)/saved-jobs", "career"],
      ["/(candidate)/applications", "career"],
      ["/(candidate)/job-matches", "aiSearch"],
      ["/(candidate)/external-jobs", "aiSearch"],
      ["/(candidate)/chats", "chats"],
      ["/(candidate)/profile", "more"],
      ["/(candidate)/plans", "more"],
    ];
    for (const [path, id] of cases) {
      expect(activeTabId(CANDIDATE_TABS, path)).toBe(id);
    }

    for (const path of ["/(recruiter)/vacancies", "/(recruiter)/candidates", "/(recruiter)/compare"]) {
      expect(activeTabId(RECRUITER_TABS, path)).toBe("hiring");
    }
  });

  it("keeps each role's destinations out of the other's bar", () => {
    const candidate = CANDIDATE_TABS.map((tab) => tab.href ?? "").join(" ");
    expect(candidate).not.toMatch(/vacancies|compare|recruiter/);

    const recruiter = RECRUITER_TABS.map((tab) => tab.href ?? "").join(" ");
    expect(recruiter).not.toMatch(/saved-jobs|job-matches|candidate\)/);
  });

  it("has a real screen behind every routing tab", () => {
    for (const tab of [...CANDIDATE_TABS, ...RECRUITER_TABS]) {
      if (!tab.href) continue;
      const file = join(ROOT, "app", `${tab.href.replace(/^\//, "")}.tsx`);
      expect(existsSync(file)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("sheets lead to screens that exist", () => {
  const SHEET_ROUTES = [
    // Career
    "app/(candidate)/jobs.tsx",
    "app/(candidate)/saved-jobs.tsx",
    "app/(candidate)/applications.tsx",
    // AI Search
    "app/(candidate)/job-matches.tsx",
    "app/(candidate)/external-jobs.tsx",
    // More
    "app/(candidate)/profile.tsx",
    "app/(candidate)/job-preferences.tsx",
    "app/(candidate)/plans.tsx",
    "app/(candidate)/settings.tsx",
    "app/(candidate)/notifications.tsx",
    // Hiring
    "app/(recruiter)/vacancies.tsx",
    "app/(recruiter)/candidates/index.tsx",
    "app/(recruiter)/compare.tsx",
    // Recruiter AI Search
    "app/(recruiter)/search.tsx",
    "app/(recruiter)/external-search.tsx",
    // Recruiter More
    "app/(recruiter)/plans.tsx",
    "app/(recruiter)/settings.tsx",
    "app/(recruiter)/notifications.tsx",
  ];

  it.each(SHEET_ROUTES)("%s exists", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(true);
  });

  it("leaves no placeholder standing in for a built feature", () => {
    for (const path of SHEET_ROUTES) {
      // The COMPONENT, not the `placeholder=` prop every text input has.
      expect(source(path)).not.toContain("components/ui/Placeholder");
    }
  });
});

/* ------------------------------------------------------------------ */

describe("entitlements are the server's decision", () => {
  it("draws the lock but never enforces it", () => {
    const entitlements = source("lib/auth/entitlements.ts");
    // Unstated capabilities mean the server said nothing, not "free".
    expect(entitlements).toContain("return true");

    for (const path of [
      "app/(candidate)/job-matches.tsx",
      "app/(candidate)/external-jobs.tsx",
    ]) {
      const text = source(path);
      // The 403 is handled as well as the local hint, so a stale session
      // still meets the paywall rather than an unexplained error.
      expect(text).toContain("PLAN_UPGRADE_REQUIRED");
      expect(text).toContain("allows(");
    }
  });

  it("never persists a plan on the device", () => {
    for (const file of APP_FILES) {
      expect(source(file)).not.toMatch(/setItemAsync\([^)]*plan/i);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("Toss checkout stays off the device", () => {
  it("opens a hosted URL and holds no card field or key", () => {
    const billing = source("features/billing/queries.ts");
    const plans = source("app/(candidate)/plans.tsx");

    expect(billing).toContain("/candidate-account/me/billing/checkout");
    expect(billing).toContain("redirectUrl");
    expect(billing).toContain("openAuthSessionAsync");

    for (const text of [billing, plans]) {
      /*
       * Comments are stripped first: the prose explaining that no card
       * number, expiry or CVC is handled would otherwise trip the very
       * sweep that proves it.
       */
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/cardNumber|cvc|expiry|secretKey|clientKey|tosspayments/i);
    }
  });

  it("refuses a redirect that is not an ordinary https URL", () => {
    expect(isNavigableCheckoutUrl("https://checkout.example.com/abc")).toBe(true);
    // A client that opens whatever it is handed has no defence if the
    // backend is ever wrong or compromised.
    expect(isNavigableCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isNavigableCheckoutUrl("http://checkout.example.com")).toBe(false);
    expect(isNavigableCheckoutUrl("")).toBe(false);
  });

  it("re-reads the plan from the server after the browser closes", () => {
    const billing = source("features/billing/queries.ts");
    expect(billing).toContain("onSettled");
    expect(billing).toContain("invalidateQueries");
    // A dismissed browser is not proof of payment, so nothing sets a plan.
    expect(billing).not.toMatch(/setQueryData[^;]*plan/);
  });

  it("prices candidates for real and recruiters not at all", () => {
    expect(CANDIDATE_TIERS.map((tier) => tier.monthlyUsd)).toEqual([0, 7, 12]);
    expect(CANDIDATE_TIERS.map((tier) => tier.krw)).toEqual([null, "9,900", "16,900"]);

    // No approved recruiter pricing exists; null must never render as zero.
    const paid = RECRUITER_TIERS.filter((tier) => tier.availability === "planned");
    expect(paid.every((tier) => tier.monthlyUsd === null)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("recruiter surfaces stay honest", () => {
  it("labels external sourcing as planned, never as connected", () => {
    const screen = source("app/(recruiter)/external-search.tsx");
    expect(PLANNED_SOURCES).toEqual(["LinkedIn", "Saramin", "JobKorea"]);
    // The words that would claim a live integration.
    expect(screen).not.toMatch(/\b(Connected|Integrated|Live|Search now)\b/);
    expect(screen).toMatch(/comingSoon|planned/i);
  });

  it("keeps vacancy context on every candidate surface", () => {
    for (const path of [
      "app/(recruiter)/candidates/index.tsx",
      "app/(recruiter)/candidates/[id].tsx",
      "app/(recruiter)/compare.tsx",
      "app/(recruiter)/search.tsx",
    ]) {
      expect(source(path)).toMatch(/vacancyId|VacancyPicker/);
    }
  });

  it("offers no manual candidate upload anywhere", () => {
    // Applying is the only entry path in this product.
    for (const path of [
      "app/(recruiter)/candidates/index.tsx",
      "app/(recruiter)/vacancies.tsx",
    ]) {
      expect(source(path)).not.toMatch(/DocumentPicker|ImagePicker|uploadCandidate/);
    }
  });
});

/* ------------------------------------------------------------------ */

describe("compare reports evidence, and invents nothing", () => {
  const vacancy: VacancyDetail = {
    id: "v1",
    title: "Backend Engineer",
    status: "OPEN",
    location: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    requirements: [
      { id: "r1", text: "Go", required: true },
      { id: "r2", text: "Kafka", required: false },
    ],
  };

  const candidate = (id: string): CandidateSummaryRow => ({
    id,
    fullName: `Candidate ${id}`,
    currentTitle: null,
    location: null,
    totalExperienceYears: null,
  });

  it("marks a requirement the map never mentioned as NOT_RUN", () => {
    const map: EvidenceMap = {
      hasRun: true,
      requirements: [{ requirementId: "r1", status: "STRONG", citations: [] }],
    };

    const result = buildComparison(vacancy, [{ candidate: candidate("a"), map }]);
    expect(result.rows[0].cells[0].status).toBe("STRONG");
    // NOT "GAP": nobody checked, which is a different fact from finding
    // nothing when you did.
    expect(result.rows[1].cells[0].status).toBe("NOT_RUN");
  });

  it("names the candidates whose map has never been generated", () => {
    const never: EvidenceMap = { hasRun: false, requirements: [] };
    const ran: EvidenceMap = {
      hasRun: true,
      requirements: [{ requirementId: "r1", status: "GAP", citations: [] }],
    };

    const result = buildComparison(vacancy, [
      { candidate: candidate("a"), map: never },
      { candidate: candidate("b"), map: ran },
    ]);
    expect(result.unmappedCandidateIds).toEqual(["a"]);
  });

  it("produces no score, total, ranking or winner", () => {
    const map: EvidenceMap = {
      hasRun: true,
      requirements: [{ requirementId: "r1", status: "PARTIAL", citations: [] }],
    };
    const result = buildComparison(vacancy, [{ candidate: candidate("a"), map }]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"score"|"total"|"rank"|"percent"|"winner"/);
    // The statuses stay categorical, because the judgement behind them is.
    for (const row of result.rows) {
      for (const cell of row.cells) {
        expect(["STRONG", "PARTIAL", "GAP", "NOT_RUN"]).toContain(cell.status);
      }
    }
  });

  it("caps how many candidates a comparison may hold", () => {
    expect(MAX_COMPARE_CANDIDATES).toBe(4);
    const screen = source("app/(recruiter)/compare.tsx");
    expect(screen).toContain("MAX_COMPARE_CANDIDATES");
  });
});

/* ------------------------------------------------------------------ */

describe("chat", () => {
  const message = (id: string): ChatMessage => ({
    id,
    conversationId: "c1",
    body: `body ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("ignores a message it already holds", () => {
    const current = [message("m1"), message("m2")];
    // Arrives twice: once as the POST reply, once as the socket echo.
    expect(mergeMessage(current, message("m2"))).toBe(current);
    expect(mergeMessage(current, message("m3"))).toHaveLength(3);
  });

  it("ignores an event with no id rather than rendering a blank row", () => {
    const current = [message("m1")];
    expect(mergeMessage(current, { ...message(""), id: "" })).toBe(current);
  });

  it("sends over REST and receives over the socket", () => {
    const messages = source("features/chat/messages.ts");
    expect(messages).toContain("method: \"POST\"");
    // A dropped emit is indistinguishable from one in flight.
    expect(messages).not.toContain("emit(\"message.send\"");

    const socket = source("lib/realtime/socket.ts");
    expect(socket).toContain("message.new");
    expect(socket).toContain("conversation.join");
  });

  it("rejoins and refetches after a reconnect", () => {
    const socket = source("lib/realtime/socket.ts");
    expect(socket).toContain("onResync");
    expect(socket).toContain("AppState");
    // No second realtime backend was invented.
    expect(socket).toContain("CHAT_SOCKET_URL");
  });

  it("uses the two audience-scoped conversation paths, never one merged URL", () => {
    const messages = source("features/chat/messages.ts");
    expect(messages).toContain("/candidate-account/me/conversations");
    expect(messages).toContain("/conversations");
  });
});

/* ------------------------------------------------------------------ */

describe("notifications", () => {
  it("uses the existing contract and adds no preference UI", () => {
    const queries = source("features/notifications/queries.ts");
    expect(queries).toContain("/notifications");
    expect(queries).toContain("unread-count");
    expect(queries).toContain("read-all");

    const screen = source("components/navigation/NotificationsScreen.tsx");
    // That system was removed from the product; a toggle would control
    // nothing while looking like it worked.
    expect(screen).not.toMatch(/preference|Switch|emailToggle/i);
  });

  it("says an outage is an outage rather than showing an empty list", () => {
    const screen = source("components/navigation/NotificationsScreen.tsx");
    expect(screen).toContain("NOTIFICATIONS_UNAVAILABLE");
  });
});

/* ------------------------------------------------------------------ */

describe("candidate data is never invented", () => {
  it("shows a posting date only when the employer published one", () => {
    const screen = source("app/(candidate)/external-jobs.tsx");
    expect(screen).toContain("employerPostedAt");
    expect(screen).toContain("postedUnknown");
  });

  it("labels the ranking as a rank, not as a probability", () => {
    const screen = source("app/(candidate)/external-jobs.tsx");
    expect(screen).toContain("scoreLabel");
    expect(en.externalJobs.scoreLabel).toBe("Match rank");
  });

  it("treats a blank preference as unstated rather than as zero", () => {
    const screen = source("app/(candidate)/job-preferences.tsx");
    expect(screen).toContain("return null");
    expect(screen).toContain("notStatedHint");
  });

  it("warns that deleting a document withdraws it everywhere", () => {
    const screen = source("app/(candidate)/profile.tsx");
    expect(screen).toContain("deleteWarning");
    expect(en.profile.deleteWarning).toMatch(/everywhere/i);
  });

  it("re-checks no backend limit locally", () => {
    const queries = source("features/profile/queries.ts");
    // The 3-file cap and the size ceiling belong to the server.
    expect(queries).not.toMatch(/length\s*>=?\s*3|50\s*\*\s*1024/);
    expect(source("app/(candidate)/profile.tsx")).toContain(
      "PERSONAL_DOCUMENT_LIMIT_REACHED",
    );
  });
});

/* ------------------------------------------------------------------ */

describe("localization", () => {
  const dictionaries = { en, ko, ru, uz };

  it("ships all four locales", () => {
    expect([...LOCALES].sort()).toEqual(["en", "ko", "ru", "uz"]);
  });

  function keys(value: unknown, prefix = ""): string[] {
    if (typeof value === "string") return [prefix];
    return Object.entries(value as object).flatMap(([key, child]) =>
      keys(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  function valueAt(dictionary: object, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], dictionary);
  }

  /*
   * One test per locale rather than one loop over four. Jest has no
   * per-assertion message, so the locale has to be in the TEST NAME or a
   * failure says only "expected a to equal b" about an unnamed dictionary.
   */
  it.each(Object.entries(dictionaries))(
    "%s gives every key a non-empty value",
    (_locale, dictionary) => {
      for (const path of keys(dictionary)) {
        expect(String(valueAt(dictionary, path)).length).toBeGreaterThan(0);
      }
    },
  );

  it.each(Object.entries(dictionaries))(
    "%s holds exactly the English key set",
    (_locale, dictionary) => {
      expect(keys(dictionary).sort()).toEqual(keys(en).sort());
    },
  );

  it("hard-codes no user-facing string in a screen", () => {
    /*
     * A crude but effective sweep: a JSX text node of two or more words in
     * Latin letters is almost always copy that escaped the dictionary.
     * Placeholders and class strings are not text nodes, so they do not trip.
     */
    const screens = [
      "app/(candidate)/jobs.tsx",
      "app/(candidate)/external-jobs.tsx",
      "app/(candidate)/job-preferences.tsx",
      "app/(candidate)/profile.tsx",
      "app/(candidate)/plans.tsx",
      "app/(recruiter)/candidates/index.tsx",
      "app/(recruiter)/candidates/[id].tsx",
      "app/(recruiter)/compare.tsx",
      "app/(recruiter)/search.tsx",
      "app/(recruiter)/vacancies.tsx",
      "components/settings/SettingsScreen.tsx",
      "components/chat/ChatThread.tsx",
    ];
    const offenders: string[] = [];
    for (const path of screens) {
      const text = source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      for (const match of text.matchAll(/>\s*([A-Z][a-z]+ [a-z][A-Za-z ]{3,})\s*</g)) {
        offenders.push(`${path}: ${match[1]}`);
      }
    }
    // Named, so a failure says WHICH string in WHICH screen.
    expect(offenders).toEqual([]);
  });
});
