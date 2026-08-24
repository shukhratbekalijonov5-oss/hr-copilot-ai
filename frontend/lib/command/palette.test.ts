import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandsFor,
  filterCommands,
  groupCommands,
  moveActiveIndex,
} from "@/lib/command/palette";
import { timelineFor } from "@/lib/candidate/timeline";
import en from "@/lib/i18n/dictionaries/en";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import type {
  OrganizationWorkspace,
  PersonalWorkspace,
} from "@/lib/workspace/types";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const personal: PersonalWorkspace = {
  kind: "personal",
  id: "personal",
  name: "Aziza",
};

const org = (role: OrganizationWorkspace["role"]): OrganizationWorkspace => ({
  kind: "organization",
  id: "org-1",
  name: "Northwind",
  slug: "nw",
  role,
});

describe("command palette commands", () => {
  it("offers the job seeker their own routes, including the dashboard", () => {
    const hrefs = commandsFor(personal, en).map((c) => c.href);
    expect(hrefs).toContain("/home");
    expect(hrefs).toContain("/jobs");
    expect(hrefs).toContain("/job-matches");
    expect(hrefs).toContain("/external-jobs");
    expect(hrefs).toContain("/saved-jobs");
    expect(hrefs).toContain("/my-applications");
    expect(hrefs).toContain("/my-profile");
    expect(hrefs).toContain("/plans");
    expect(hrefs).toContain("/settings");
    // ...and never a recruiter route.
    expect(hrefs).not.toContain("/vacancies");
    expect(hrefs).not.toContain("/compare");
  });

  it("inherits role filtering rather than reimplementing it", () => {
    const owner = commandsFor(org("OWNER"), en).map((c) => c.href);
    expect(owner).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/vacancies",
        "/candidates",
        "/search",
        "/compare",
        "/plans",
        "/settings",
      ]),
    );

    // An interviewer has no Compare link, so no Compare command either.
    const interviewer = commandsFor(org("INTERVIEWER"), en).map((c) => c.href);
    expect(interviewer).not.toContain("/compare");
    expect(interviewer).not.toContain("/vacancies");
    expect(interviewer).toContain("/candidates");
  });

  it("labels and groups every command in the reader's language", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const command of commandsFor(personal, dictionary)) {
        expect(command.label, `${locale} ${command.href}`).toBeTruthy();
        expect(command.group, `${locale} ${command.href}`).toBeTruthy();
      }
    }
  });
});

describe("command filtering", () => {
  const commands = commandsFor(personal, en);

  it("matches case-insensitively on the visible label", () => {
    const hits = filterCommands(commands, "SAVED").map((c) => c.href);
    expect(hits).toEqual(["/saved-jobs"]);
  });

  it("returns everything for an empty or whitespace query", () => {
    expect(filterCommands(commands, "")).toHaveLength(commands.length);
    expect(filterCommands(commands, "   ")).toHaveLength(commands.length);
  });

  it("returns nothing rather than a guess when nothing matches", () => {
    expect(filterCommands(commands, "zzzz")).toEqual([]);
  });

  it("groups results without reordering or emitting empty groups", () => {
    const groups = groupCommands(filterCommands(commands, "job"));
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.commands.length).toBeGreaterThan(0);
    }
    const flat = groups.flatMap((g) => g.commands.map((c) => c.href));
    expect(flat).toEqual(filterCommands(commands, "job").map((c) => c.href));
  });

  it("wraps the selection at both ends", () => {
    expect(moveActiveIndex(0, -1, 5)).toBe(4);
    expect(moveActiveIndex(4, 1, 5)).toBe(0);
    // An empty result list must not produce NaN or a negative index.
    expect(moveActiveIndex(0, 1, 0)).toBe(0);
  });
});

describe("command palette behaviour", () => {
  const palette = code("components/layout/CommandPalette.tsx");

  it("navigates only — it never calls an API", () => {
    expect(palette).toContain("router.push");
    expect(palette).not.toMatch(/fetch\(|api\.|useSWR|action\(/);
  });

  it("opens on Cmd+K and Ctrl+K, and closes on Escape", () => {
    expect(palette).toContain("event.metaKey || event.ctrlKey");
    expect(palette).toContain('event.key.toLowerCase() === "k"');
    expect(palette).toContain('event.key === "Escape"');
    expect(palette).toContain("event.preventDefault()");
  });

  it("uses the combobox/listbox pattern with a virtual selection", () => {
    expect(palette).toContain('role="combobox"');
    expect(palette).toContain('role="listbox"');
    expect(palette).toContain('role="option"');
    expect(palette).toContain("aria-activedescendant");
    expect(palette).toContain("aria-selected={selected}");
  });

  it("localizes its own copy", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.palette.title, locale).toBeTruthy();
      expect(dictionary.palette.placeholder, locale).toBeTruthy();
      expect(dictionary.palette.empty, locale).toBeTruthy();
      expect(dictionary.palette.hint, locale).toBeTruthy();
    }
  });
});

describe("application timeline", () => {
  it("marks earlier stages done because the status implies them", () => {
    expect(timelineFor("INTERVIEW").map((n) => n.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
    ]);
  });

  it("shows a fresh application at the first node only", () => {
    expect(timelineFor("NEW").map((n) => n.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("closes the decision node for a rejection rather than filling it", () => {
    const nodes = timelineFor("REJECTED");
    expect(nodes[3].state).toBe("closed");
    expect(nodes.slice(0, 3).every((n) => n.state === "done")).toBe(true);
  });

  it("claims nothing beyond submission for a withdrawn application", () => {
    const nodes = timelineFor("WITHDRAWN");
    expect(nodes[0].state).toBe("current");
    // The candidate ended it; how far it had got is not recorded.
    expect(nodes.slice(1).every((n) => n.state === "closed")).toBe(true);
  });

  it("treats an offer and a hire as having reached the decision", () => {
    expect(timelineFor("OFFER")[3].state).toBe("current");
    expect(timelineFor("HIRED")[3].state).toBe("current");
  });

  it("distinguishes states by glyph, not colour alone", () => {
    const view = code("components/candidate/ui/ApplicationTimeline.tsx");
    expect(view).toContain("CheckIcon");
    expect(view).toContain("CloseIcon");
    // The stage name is always printed beside the node.
    expect(view).toContain("label[node.id]");
  });
});

describe("spotlight is selective and cheap", () => {
  it("never re-renders React on pointer movement", () => {
    const hook = code("lib/ui/use-spotlight.ts");
    expect(hook).toContain("style.setProperty");
    expect(hook).not.toContain("useState");
  });

  it("is applied only to the named surfaces", () => {
    const withSpotlight = [
      "components/candidate/home/DashboardAiEntries.tsx",
      "components/candidate/MatchCard.tsx",
      "components/plan/PlanCard.tsx",
      "components/plan/RecruiterPlansPreview.tsx",
    ];
    for (const file of withSpotlight) {
      expect(code(file), file).toContain("useSpotlight");
    }
    // Dense lists and rows must never carry it.
    for (const file of [
      "components/candidate/MyApplicationsView.tsx",
      "components/candidate/SavedJobsView.tsx",
      "components/candidate/home/DashboardPipeline.tsx",
    ]) {
      expect(code(file), file).not.toContain("spotlight");
    }
  });

  it("is disabled under reduced motion", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    const block = css.slice(css.indexOf(".spotlight {"));
    expect(block).toContain("prefers-reduced-motion: reduce");
  });
});
