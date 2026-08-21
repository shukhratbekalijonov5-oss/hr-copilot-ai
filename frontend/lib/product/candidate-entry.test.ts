import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The product removed HR-side candidate creation and HR-side file upload.
 *
 * These assertions run over the SOURCE TREE rather than a rendered DOM,
 * because the claim being made is architectural: not "the button is hidden on
 * this screen" but "no recruiter surface anywhere offers this, and no client
 * function exists to call the removed endpoints". A component test could only
 * ever prove the former, one screen at a time.
 */

const root = fileURLToPath(new URL("../..", import.meta.url));
const SEARCHED = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "__snapshots__"]);

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      if ((await stat(full)).isDirectory()) {
        await walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
    }
  }
  for (const dir of SEARCHED) await walk(path.join(root, dir));
  return found;
}

/** Recruiter surfaces only — the candidate's own screens keep their upload. */
function isRecruiterSurface(file: string): boolean {
  const rel = path.relative(root, file);
  if (rel.includes("(candidate)")) return false;
  if (rel.startsWith(path.join("components", "candidate", ""))) return false;
  if (rel.startsWith(path.join("components", "jobs", ""))) return false;
  if (rel.includes("candidate-account")) return false;
  return true;
}

async function read(files: string[]): Promise<[string, string][]> {
  return Promise.all(
    files.map(async (file) => [file, await readFile(file, "utf8")] as const),
  ).then((pairs) => pairs.map(([f, c]) => [path.relative(root, f), c]));
}

describe("HR candidate creation is gone from the product", () => {
  it("has no add-candidate route", async () => {
    await expect(stat(path.join(root, "app/(app)/candidates/new"))).rejects.toThrow();
  });

  it("has no candidate form or add-candidate action", async () => {
    await expect(
      stat(path.join(root, "components/candidates/CandidateForm.tsx")),
    ).rejects.toThrow();
    await expect(
      stat(path.join(root, "components/candidates/ApplicationSourceBadge.tsx")),
    ).rejects.toThrow();
  });

  it("links nowhere to /candidates/new", async () => {
    const offenders = (await read(await sourceFiles()))
      .filter(([, content]) => content.includes("/candidates/new"))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps no client function for the removed endpoints", async () => {
    const [, apiIndex] = (await read([path.join(root, "lib/api/index.ts")]))[0];
    expect(apiIndex).not.toContain("createCandidate:");
    expect(apiIndex).not.toContain("createApplication:");

    const [, service] = (
      await read([path.join(root, "lib/api/candidates.service.ts")])
    )[0];
    expect(service).not.toContain("export async function createCandidate");
  });
});

describe("HR file upload is gone from the product", () => {
  it("has no uploader component, upload hook or upload proxy route", async () => {
    await expect(stat(path.join(root, "components/upload"))).rejects.toThrow();
    await expect(
      stat(path.join(root, "lib/hooks/useResumeUpload.ts")),
    ).rejects.toThrow();
    await expect(stat(path.join(root, "app/api/uploads"))).rejects.toThrow();
  });

  it("exposes no uploadDocument client call", async () => {
    const [, documents] = (
      await read([path.join(root, "lib/api/documents.service.ts")])
    )[0];
    const [, apiIndex] = (await read([path.join(root, "lib/api/index.ts")]))[0];
    expect(documents).not.toContain("export async function uploadDocument");
    expect(apiIndex).not.toContain("uploadDocument:");
  });

  it("has no recruiter surface referencing the upload proxy or uploader", async () => {
    const offenders = (await read((await sourceFiles()).filter(isRecruiterSurface)))
      .filter(
        ([, content]) =>
          content.includes("/api/uploads") ||
          content.includes("ResumeUploader") ||
          content.includes("useResumeUpload"),
      )
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });

  it("leaves the CANDIDATE'S own upload untouched", async () => {
    const [, account] = (
      await read([path.join(root, "lib/api/candidate-account.service.ts")])
    )[0];
    // Removing the recruiter path must not touch the job seeker's own files.
    expect(account).toContain("uploadPersonalDocument");
    expect(account).toContain("deletePersonalDocument");
  });
});

describe("recruiter copy is applicant-first, with no add/upload call to action", () => {
  it("empty states invite applicants rather than asking HR to add someone", async () => {
    const { ALL_DICTIONARIES } = await import("@/lib/i18n/dictionary");
    for (const { locale, dictionary: d } of ALL_DICTIONARIES) {
      // A waiting state, never "add your first candidate" / "upload a CV".
      expect(d.vacancyDetail.noCandidatesHint, locale).toBeTruthy();
      expect(d.dashboard.noCandidatesHint, locale).toBeTruthy();
      expect(d.vacancyScope.noCandidatesHint, locale).toBeTruthy();
      // The removed features' copy is gone from every locale.
      expect("add" in d.candidates, locale).toBe(false);
      expect("uploadPrompt" in d.candidates, locale).toBe(false);
      expect("newCandidateHint" in d.vacancyDetail, locale).toBe(false);
      expect("noCandidateAccount" in d.chat, locale).toBe(false);
      expect("candidateAlreadyInVacancy" in d.vacancyScope, locale).toBe(
        false,
      );
    }
  });

  it("every locale still carries the applicant-facing notification copy", async () => {
    const { ALL_DICTIONARIES } = await import("@/lib/i18n/dictionary");
    for (const { locale, dictionary: d } of ALL_DICTIONARIES) {
      expect(Object.keys(d.notifications.types).sort(), locale).toEqual([
        "APPLICATION_REJECTED",
        "INTERVIEW_INVITATION",
        "NEW_APPLICATION",
        "NEW_MESSAGE",
        "VACANCY_DELETED",
      ]);
    }
  });
});
