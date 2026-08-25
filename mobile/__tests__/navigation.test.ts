import en from "@/lib/i18n/en";
import ko from "@/lib/i18n/ko";
import ru from "@/lib/i18n/ru";
import uz from "@/lib/i18n/uz";
import {
  CANDIDATE_TABS,
  RECRUITER_TABS,
  activeTabId,
  titleForPath,
} from "@/lib/navigation/tabs";

const ALL = [
  ["en", en],
  ["ko", ko],
  ["ru", ru],
  ["uz", uz],
] as const;

describe("candidate bottom navigation", () => {
  it("is exactly Home / Career / AI Search / Chats / More", () => {
    expect(CANDIDATE_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "career",
      "aiSearch",
      "chats",
      "more",
    ]);
  });

  it("gives Chats a route of its own, and Career none", () => {
    const chats = CANDIDATE_TABS.find((tab) => tab.id === "chats");
    const career = CANDIDATE_TABS.find((tab) => tab.id === "career");

    expect(chats?.kind).toBe("route");
    expect(chats?.href).toContain("/chats");
    // Career opens a sheet — it has no page of its own to land on.
    expect(career?.kind).toBe("sheet");
    expect(career?.href).toBeUndefined();
  });

  it("never exposes a recruiter destination", () => {
    const hrefs = CANDIDATE_TABS.map((tab) => tab.href ?? "").join(" ");
    expect(hrefs).not.toContain("vacancies");
    expect(hrefs).not.toContain("recruiter");
  });
});

describe("recruiter bottom navigation", () => {
  it("is exactly Home / Hiring / AI Search / Chats / More", () => {
    expect(RECRUITER_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "hiring",
      "aiSearch",
      "chats",
      "more",
    ]);
  });

  it("gives Chats a route and Hiring a sheet", () => {
    expect(RECRUITER_TABS.find((tab) => tab.id === "chats")?.kind).toBe("route");
    expect(RECRUITER_TABS.find((tab) => tab.id === "hiring")?.kind).toBe("sheet");
  });

  it("never exposes a candidate destination", () => {
    const hrefs = RECRUITER_TABS.map((tab) => tab.href ?? "").join(" ");
    expect(hrefs).not.toContain("saved-jobs");
    expect(hrefs).not.toContain("candidate)");
  });
});

describe("active tab", () => {
  it("lights Career for all three of its pages", () => {
    for (const path of ["/saved-jobs", "/applications", "/jobs"]) {
      expect(activeTabId(CANDIDATE_TABS, path)).toBe("career");
    }
  });

  it("lights AI Search for both AI universes", () => {
    expect(activeTabId(CANDIDATE_TABS, "/job-matches")).toBe("aiSearch");
    expect(activeTabId(CANDIDATE_TABS, "/external-jobs")).toBe("aiSearch");
  });
});

describe("header title", () => {
  it("names the current page, not the tab that opened it", () => {
    expect(titleForPath("/saved-jobs", en)).toBe(en.titles.savedJobs);
    expect(titleForPath("/applications", en)).toBe(en.titles.myApplications);
    expect(titleForPath("/home", en)).toBe(en.titles.dashboard);
    expect(titleForPath("/vacancies", en)).toBe(en.titles.vacancies);
  });

  it("does not let a shorter route capture a longer one", () => {
    // `/jobs` must not swallow `/job-matches`, nor `/search` `/external-search`.
    expect(titleForPath("/job-matches", en)).toBe(en.titles.internalAiJobs);
    expect(titleForPath("/external-search", en)).toBe(en.titles.externalAiSearch);
    expect(titleForPath("/job-preferences", en)).toBe(en.titles.jobPreferences);
  });

  it("resolves a title in every locale", () => {
    for (const [name, dictionary] of ALL) {
      expect(`${name}:${titleForPath("/saved-jobs", dictionary)}`).not.toBe(`${name}:`);
      expect(`${name}:${titleForPath("/vacancies", dictionary)}`).not.toBe(`${name}:`);
    }
  });
});

describe("locales", () => {
  it("keeps all four dictionaries structurally identical", () => {
    const shape = (value: unknown): unknown =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .map(([key, inner]) => [key, shape(inner)])
              .sort(([a], [b]) => String(a).localeCompare(String(b))),
          )
        : typeof value;

    const reference = JSON.stringify(shape(en));
    for (const [name, dictionary] of ALL) {
      expect({ [name]: JSON.stringify(shape(dictionary)) }).toEqual({ [name]: reference });
    }
  });
});
