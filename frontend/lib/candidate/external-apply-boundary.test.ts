import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Opening the employer's site must never record an application.
 *
 * This is the one rule in 4C.5 that no unit test of a pure function can
 * protect, because breaking it looks like a one-line convenience: add an
 * `onClick` to the Apply anchor that also marks the job applied. It would ship
 * green, and it would quietly fill people's history with applications they
 * abandoned on the employer's first form — which they would discover by being
 * asked about a job they never applied for.
 *
 * So the guard reads the source. It is blunt on purpose: an Apply anchor with
 * ANY handler on it fails, and the reviewer has to come and read this comment.
 */

const ROOT = join(process.cwd(), "components/external");

const SURFACES = [
  "ExternalJobCard.tsx",
  "ExternalJobDetailDrawer.tsx",
  "SavedExternalJobsView.tsx",
  "ExternalApplicationsView.tsx",
];

function read(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** Every `<a …>` opening tag in a file, comments stripped. */
function anchors(source: string): string[] {
  const withoutComments = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutComments.match(/<a\b[\s\S]*?>/g) ?? [];
}

describe("the Apply link is navigation and nothing else", () => {
  it.each(SURFACES)("%s carries no handler on any external anchor", (file) => {
    for (const anchor of anchors(read(file))) {
      expect(anchor, `${file}: ${anchor}`).not.toMatch(/onClick/);
      expect(anchor, `${file}: ${anchor}`).not.toMatch(/onAuxClick/);
      expect(anchor, `${file}: ${anchor}`).not.toMatch(/onMouseDown/);
    }
  });

  it.each(SURFACES)("%s never calls a tracking mutation from a link", (file) => {
    const source = read(file);
    // The tracking mutations are reached only through the shared control.
    // No surface calls them directly, so no surface can call one from an
    // anchor's handler.
    expect(source).not.toMatch(/trackExternalApplicationAction/);
    expect(source).not.toMatch(/personal\.markApplied/);
  });

  it("keeps every external link safe to open", () => {
    // `noopener` denies the employer's page a handle on the tab a candidate
    // came from; `noreferrer` keeps our URL — including their search terms —
    // out of the employer's logs. Both, on every external anchor.
    for (const file of SURFACES) {
      for (const anchor of anchors(read(file))) {
        if (!anchor.includes('target="_blank"')) continue;
        expect(anchor, `${file}: ${anchor}`).toContain("noopener");
        expect(anchor, `${file}: ${anchor}`).toContain("noreferrer");
      }
    }
  });

  it("routes every mutation through the one service layer", () => {
    // No component knows a URL. When the backend finalizes a different path,
    // the edit is in the service and nowhere else.
    for (const file of SURFACES) {
      const source = read(file);
      expect(source, file).not.toMatch(/candidate-account\/me\/external/);
      expect(source, file).not.toMatch(/\bfetch\(/);
    }
  });
});

describe("the tracking control is the only thing that records an application", () => {
  const control = readFileSync(
    join(ROOT, "ExternalTrackingControl.tsx"),
    "utf8",
  );

  it("marks applied from a button, never from a link", () => {
    expect(control).toMatch(/personal\.markApplied/);
    // No anchor at all in this component: it does not navigate anywhere.
    expect(anchors(control)).toHaveLength(0);
  });

  it("does not save or unsave as a side effect of tracking", () => {
    expect(control).not.toMatch(/toggleSaved/);
  });
});

describe("the save control does not track", () => {
  const save = readFileSync(join(ROOT, "ExternalSaveButton.tsx"), "utf8");

  it("only toggles saving", () => {
    expect(save).toMatch(/personal\.toggleSaved/);
    expect(save).not.toMatch(/markApplied/);
    expect(save).not.toMatch(/removeTracking/);
  });

  it("states its state in words and aria, never in colour alone", () => {
    expect(save).toMatch(/aria-pressed/);
    // A visible or accessible label on every render, both variants.
    expect(save).toMatch(/aria-label=/);
    expect(save).toMatch(/stateLabel/);
  });
});

describe("internal and external stay two different products", () => {
  const APP = join(process.cwd(), "app/(candidate)");

  it("keeps the external tab strip out of the internal lists", () => {
    // `/saved-jobs` and `/my-applications` are the INTERNAL history: those
    // applications were received here and a recruiter set their stages. The
    // external strip must not appear on them, or the two would read as one
    // list where identical rows mean different things.
    for (const file of [
      "saved-jobs/page.tsx",
      "my-applications/page.tsx",
    ]) {
      const source = readFileSync(join(APP, file), "utf8");
      expect(source, file).not.toMatch(/ExternalJobsTabs/);
      expect(source, file).not.toMatch(/external-job/);
    }
  });

  it("keeps external tracking out of the internal application surfaces", () => {
    for (const file of [
      "saved-jobs/page.tsx",
      "my-applications/page.tsx",
    ]) {
      const source = readFileSync(join(APP, file), "utf8");
      expect(source, file).not.toMatch(/ExternalTrackingControl/);
      expect(source, file).not.toMatch(/trackExternalApplication/);
    }
  });

  it("points the external list at the internal one rather than absorbing it", () => {
    // The external page links to `/my-applications` so a reader who wants the
    // verified history knows where it lives — a signpost, not a merge.
    const view = readFileSync(
      join(process.cwd(), "components/external/ExternalApplicationsView.tsx"),
      "utf8",
    );
    expect(view).toMatch(/href="\/my-applications"/);
  });
});
