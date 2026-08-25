import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applicationPipeline,
  bandFor,
  readinessSteps,
} from "@/lib/candidate/dashboard";
import {
  bucketFor,
  groupNotifications,
} from "@/lib/notifications/grouping";
import { PERSONAL_NAV, groupNavItems } from "@/lib/workspace/navigation";
import { ALL_DICTIONARIES } from "@/lib/i18n/dictionary";
import en from "@/lib/i18n/dictionaries/en";
import type { ApplicationStatus, MyApplication, Notification } from "@/lib/types";

const ROOT = process.cwd();

function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function application(status: ApplicationStatus): MyApplication {
  return {
    id: `a-${status}`,
    status,
    source: "SELF_APPLIED" as MyApplication["source"],
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    job: {
      publicSlug: "s",
      title: "Engineer",
      location: null,
      employmentType: null,
      organizationName: "Northwind",
      applicantCount: 3,
    },
  };
}

describe("application pipeline", () => {
  it("folds seven backend stages into the four an applicant thinks in", () => {
    const pipeline = applicationPipeline([
      application("NEW"),
      application("REVIEWING"),
      application("INTERVIEW"),
      application("OFFER"),
      application("REJECTED"),
    ]);

    expect(pipeline.applied).toBe(1);
    expect(pipeline.review).toBe(1);
    expect(pipeline.interview).toBe(1);
    // OFFER and REJECTED are both "the employer decided".
    expect(pipeline.decision).toBe(2);
    expect(pipeline.total).toBe(5);
  });

  it("counts only stages an employer still has open as active", () => {
    const pipeline = applicationPipeline([
      application("NEW"),
      application("HIRED"),
      application("REJECTED"),
      application("WITHDRAWN"),
    ]);
    expect(pipeline.active).toBe(1);
  });

  it("puts a withdrawn application in no stage but still counts it", () => {
    const pipeline = applicationPipeline([application("WITHDRAWN")]);
    expect(pipeline.total).toBe(1);
    expect(
      pipeline.applied + pipeline.review + pipeline.interview + pipeline.decision,
    ).toBe(0);
  });

  it("reports an empty list as zeroes, never as absent data", () => {
    expect(applicationPipeline([])).toMatchObject({ total: 0, active: 0 });
  });
});

describe("profile readiness", () => {
  const empty = { account: null, evidence: null, preferences: null };

  it("treats a failed read as not-done rather than claiming completion", () => {
    const steps = readinessSteps(empty, en);
    expect(steps).toHaveLength(4);
    expect(steps.every((step) => !step.done)).toBe(true);
    // Every incomplete step names where to go and what to do.
    expect(steps.every((step) => Boolean(step.href && step.actionLabel))).toBe(true);
  });

  it("marks a step done only on a positive server value", () => {
    const steps = readinessSteps(
      {
        account: {
          headline: "Engineer",
          skills: ["Go"],
          resume: { id: "r" },
        } as never,
        evidence: { files: 1, links: 2, total: 3 } as never,
        preferences: { stated: true } as never,
      },
      en,
    );
    expect(steps.every((step) => step.done)).toBe(true);
  });

  it("uses the backend's `stated` flag, not the shape of the preferences", () => {
    const notStated = readinessSteps(
      { ...empty, preferences: { stated: false, preferredJobTitles: [] } as never },
      en,
    );
    expect(notStated.find((step) => step.id === "preferences")?.done).toBe(false);

    // A deliberately empty preference profile IS stated, and counts.
    const statedButEmpty = readinessSteps(
      { ...empty, preferences: { stated: true, preferredJobTitles: [] } as never },
      en,
    );
    expect(statedButEmpty.find((step) => step.id === "preferences")?.done).toBe(true);
  });
});

describe("match bands", () => {
  it("renames the backend band without ever upgrading it", () => {
    expect(bandFor("STRONG")).toBe("strong");
    expect(bandFor("GOOD")).toBe("good");
    expect(bandFor("PARTIAL")).toBe("partial");
    expect(bandFor("LOW")).toBe("partial");
    // Anything unrecognised is unknown, never guessed into a flattering band.
    expect(bandFor("")).toBe("unknown");
    expect(bandFor("EXCELLENT")).toBe("unknown");
  });

  it("prints the band as words in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const band of ["STRONG", "GOOD", "PARTIAL", "LOW"] as const) {
        expect(dictionary.jobMatch.band[band], `${locale}.${band}`).toBeTruthy();
      }
    }
  });
});

describe("notification grouping", () => {
  const now = new Date("2026-08-25T12:00:00.000Z").getTime();

  function notification(id: string, createdAt: string): Notification {
    return {
      id,
      type: "NEW_MESSAGE",
      audience: "CANDIDATE",
      isRead: false,
      createdAt,
      vacancyId: null,
      vacancyTitle: null,
      candidateId: null,
      candidateName: null,
      actorUserId: null,
      actorName: null,
      conversationId: null,
      messageId: null,
      interviewId: null,
      applicationId: null,
      messagePreview: null,
    };
  }

  it("buckets by calendar day, not by a rolling 24 hours", () => {
    expect(bucketFor("2026-08-25T09:00:00.000Z", now)).toBe("today");
    expect(bucketFor("2026-08-22T23:00:00.000Z", now)).toBe("week");
    expect(bucketFor("2026-07-01T09:00:00.000Z", now)).toBe("earlier");
  });

  it("files an unreadable date with the oldest rather than the newest", () => {
    expect(bucketFor("not-a-date", now)).toBe("earlier");
  });

  it("preserves the caller's order and omits empty buckets", () => {
    const groups = groupNotifications(
      [
        notification("a", "2026-08-25T09:00:00.000Z"),
        notification("b", "2026-08-25T08:00:00.000Z"),
        notification("c", "2026-07-01T09:00:00.000Z"),
      ],
      now,
    );

    expect(groups.map((group) => group.bucket)).toEqual(["today", "earlier"]);
    expect(groups[0].notifications.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("localizes every heading", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      expect(dictionary.notifications.groupToday, locale).toBeTruthy();
      expect(dictionary.notifications.groupWeek, locale).toBeTruthy();
      expect(dictionary.notifications.groupEarlier, locale).toBeTruthy();
    }
  });
});

describe("candidate shell", () => {
  it("opens on the dashboard and keeps it in the personal route set", () => {
    expect(PERSONAL_NAV[0].href).toBe("/home");
    expect(code("lib/auth/routing.ts")).toContain(
      'if (accountType === "CANDIDATE") return "/home";',
    );
  });

  it("keeps the free search out of the paid AI group", () => {
    const groups = groupNavItems(PERSONAL_NAV);
    const ai = groups.find((group) => group.labelKey === "sectionAiJobSearch");
    const career = groups.find((group) => group.labelKey === "sectionCareer");

    expect(ai?.items.map((item) => item.href)).toEqual([
      "/job-matches",
      "/external-jobs",
    ]);
    expect(career?.items.map((item) => item.href)).toContain("/jobs");
  });

  it("names every candidate area in all four locales", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const key of [
        "sectionHome",
        "sectionCareer",
        "sectionProfile",
        "sectionAccount",
        "home",
      ] as const) {
        expect(dictionary.nav[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it("keeps the signed-in account reachable from the header, for both roles", () => {
    const header = code("components/layout/Header.tsx");
    expect(header).toContain("logoutAction");
    expect(header).toContain("user.fullName");
    // Whose session this is matters on the recruiting side too.
    expect(header).not.toContain('kind === "personal" ? user : null');
  });
});

describe("dashboard honesty", () => {
  const page = code("app/(candidate)/home/page.tsx");

  it("lets one failed panel fail alone", () => {
    expect(page).toContain("Promise.allSettled");
    expect(page).toContain('result.status === "fulfilled"');
  });

  it("streams the expensive ranking instead of blocking the page", () => {
    expect(page).toContain("<Suspense");
    expect(page).toContain("CandidateCardSkeleton");

    const matches = code("components/candidate/home/DashboardMatches.tsx");
    // A dashboard visit reads the existing ranking; it never forces a new run.
    expect(matches).toContain("limit: 3");
    expect(matches).not.toContain("refresh: true");
  });

  it("never renders a missing count as zero", () => {
    const stats = code("components/candidate/home/DashboardStats.tsx");
    expect(stats).toContain('value === null ? "—"');
  });

  it("asks for no ranking when the plan or the evidence rules it out", () => {
    const matches = code("components/candidate/home/DashboardMatches.tsx");
    const guard = matches.indexOf("if (!canUseInternalAiJobs || !canRunJobMatch)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(matches.indexOf("api.getJobMatches"));
  });
});

describe("status is never colour alone", () => {
  it("prints the stage word beside every tone", () => {
    const badge = code("components/candidate/ui/CandidateStageBadge.tsx");
    expect(badge).toContain("d.status.candidateStage[status]");
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const status of [
        "NEW",
        "REVIEWING",
        "INTERVIEW",
        "OFFER",
        "HIRED",
        "REJECTED",
        "WITHDRAWN",
      ] as const) {
        expect(
          dictionary.status.candidateStage[status],
          `${locale}.${status}`,
        ).toBeTruthy();
      }
    }
  });

  it("gives the score ring an accessible label rather than a bare number", () => {
    const score = code("components/candidate/ui/MatchScore.tsx");
    expect(score).toContain('role="img"');
    expect(score).toContain("aria-label={label}");
  });
});
