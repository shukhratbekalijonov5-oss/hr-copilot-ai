import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextStandardPage, PAGE_SIZE } from "@/lib/query/pagination";
import { nextJobMatchPage } from "@/features/candidate/queries";
import { nextExternalPage } from "@/features/external/queries";
import {
  conversationBase,
  lastMessagePage,
  mergeMessage,
  olderMessagePage,
} from "@/features/chat/messages";
import { AVATAR_MIME_TYPES } from "@/features/profile/queries";
import type { ChatMessage, ExternalSearchResult, Paginated } from "@/types";

/**
 * Regressions for the closure pass.
 *
 * Each of these stands for a bug that was real: two 400s and a crash from
 * contract drift, a chat that opened on the oldest page, and a socket that
 * kept a rotated token. The paging rules are exported as pure functions
 * precisely so these can assert behaviour rather than grep for source text.
 */

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const page = <T,>(
  data: T[],
  meta: Partial<Paginated<T>["meta"]> = {},
): Paginated<T> => ({
  data,
  meta: { total: 100, page: 1, limit: PAGE_SIZE, totalPages: 5, ...meta },
});

/* ------------------------------------------------------------------ */

describe("contract fixes", () => {
  it("searches jobs with `search`, never `q`", () => {
    const jobs = code("features/jobs/queries.ts");
    expect(jobs).toContain("search: query || undefined");
    // `forbidNonWhitelisted` makes an unknown parameter a 400, not a no-op.
    expect(jobs).not.toMatch(/\bq:\s/);
  });

  it("builds the vacancy picker from OWNED vacancies", () => {
    const picker = code("components/recruiter/VacancyPicker.tsx");
    expect(picker).toContain("useMyVacancies");
    expect(picker).not.toContain("useVacancies(");

    const queries = code("features/recruiter/queries.ts");
    expect(queries).toContain('"/vacancies/mine"');
  });

  it("scopes candidates by ROUTE, never by a vacancyId parameter", () => {
    const candidates = code("features/recruiter/candidates.ts");
    // `/candidates` rejects `vacancyId` outright; the scoped list is its own
    // route and enforces ownership independently.
    expect(candidates).toContain("`/vacancies/${vacancyId}/candidates`");
    expect(candidates).not.toMatch(/query:\s*\{\s*vacancyId/);
  });

  it("reads documents as an envelope, not an array", () => {
    const queries = code("features/profile/queries.ts");
    expect(queries).toContain("CandidateDocumentList");
    expect(queries).not.toContain("apiFetch<CandidateDocument[]>");

    const screen = code("app/(candidate)/profile.tsx");
    expect(screen).toContain("documents.data?.data ?? []");
  });

  it("takes the upload cap from `remaining`, not from the row count", () => {
    const screen = code("app/(candidate)/profile.tsx");
    expect(screen).toContain("documents.data.remaining <= 0");
    // A tombstoned file can hold a slot it no longer appears in, so counting
    // visible rows would offer an upload the server then refuses.
    expect(screen).not.toMatch(/rows\.length\s*>=\s*3/);
  });
});

/* ------------------------------------------------------------------ */

describe("standard `{data, meta}` pagination", () => {
  it("advances while the page is below the last one", () => {
    expect(nextStandardPage(page([1], { page: 1, totalPages: 5 }))).toBe(2);
    expect(nextStandardPage(page([1], { page: 4, totalPages: 5 }))).toBe(5);
  });

  it("stops on the last page", () => {
    expect(nextStandardPage(page([1], { page: 5, totalPages: 5 }))).toBeUndefined();
  });

  it("stops when an in-range page comes back empty", () => {
    // The list shrank between two requests; the pager must not loop.
    expect(nextStandardPage(page([], { page: 2, totalPages: 9 }))).toBeUndefined();
  });

  it("stops on a malformed or missing response", () => {
    expect(nextStandardPage(undefined)).toBeUndefined();
    expect(
      nextStandardPage({ data: [1] } as unknown as Paginated<number>),
    ).toBeUndefined();
  });

  it("asks for a page size the backend accepts", () => {
    // The server caps `limit` at 100 with a 400 rather than widening.
    expect(PAGE_SIZE).toBeGreaterThan(0);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it("is what every standard list uses", () => {
    for (const file of [
      "features/candidate/queries.ts",
      "features/recruiter/queries.ts",
      "features/recruiter/candidates.ts",
      "features/notifications/queries.ts",
      "features/chat/queries.ts",
      "features/jobs/queries.ts",
    ]) {
      expect(code(file)).toContain("usePagedQuery");
    }
  });
});

/* ------------------------------------------------------------------ */

describe("internal AI match pagination", () => {
  const match = (over: Partial<Parameters<typeof nextJobMatchPage>[0]> = {}) =>
    ({
      matches: [{}],
      page: 1,
      limit: 20,
      total: 60,
      totalPages: 3,
      hasMore: true,
      generated: true,
      explanationsPending: false,
      stale: false,
      ...over,
    }) as Parameters<typeof nextJobMatchPage>[0];

  it("follows the server's `hasMore`", () => {
    expect(nextJobMatchPage(match({ page: 1, hasMore: true }))).toBe(2);
    expect(nextJobMatchPage(match({ page: 3, hasMore: false }))).toBeUndefined();
  });

  it("trusts `hasMore` over any count it could derive", () => {
    // total/limit says there are more pages; the server says there are not.
    expect(
      nextJobMatchPage(match({ page: 1, total: 999, hasMore: false })),
    ).toBeUndefined();
  });

  it("stops on an empty page even when `hasMore` lags", () => {
    expect(
      nextJobMatchPage(match({ matches: [], hasMore: true })),
    ).toBeUndefined();
  });

  it("never sends `refresh` while paging", () => {
    // Recomputing per page would reshuffle the ranking mid-scroll.
    const queries = code("features/candidate/queries.ts");
    expect(queries).not.toContain("refresh: true");
  });
});

/* ------------------------------------------------------------------ */

describe("external job pagination", () => {
  const result = (over: Partial<ExternalSearchResult> = {}): ExternalSearchResult =>
    ({
      runId: "r",
      sort: "RELEVANCE",
      asOf: "2026-01-01T00:00:00.000Z",
      total: 100,
      page: 1,
      pageSize: 20,
      degraded: false,
      results: [{}],
      ...over,
    }) as ExternalSearchResult;

  it("pages while page × pageSize is below total", () => {
    expect(nextExternalPage(result({ page: 1, pageSize: 20, total: 100 }))).toBe(2);
    expect(nextExternalPage(result({ page: 4, pageSize: 20, total: 100 }))).toBe(5);
  });

  it("stops at the end of the snapshot", () => {
    expect(
      nextExternalPage(result({ page: 5, pageSize: 20, total: 100 })),
    ).toBeUndefined();
  });

  it("uses `total`, not `matched`", () => {
    /*
     * `matched` counts what answers the filters in the database and is often
     * larger than the stored snapshot. Paging on it offers pages that cannot
     * be served.
     */
    const withBiggerMatched = {
      ...result({ page: 5, pageSize: 20, total: 100 }),
      matched: 5000,
    } as ExternalSearchResult;
    expect(nextExternalPage(withBiggerMatched)).toBeUndefined();
    expect(code("features/external/queries.ts")).not.toMatch(/last\.matched/);
  });

  it("treats a shrunken snapshot as the end, not an error", () => {
    expect(
      nextExternalPage(result({ page: 2, results: [], total: 500 })),
    ).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe("chat opens on the newest messages", () => {
  it("computes the last page from the total", () => {
    // The server orders createdAt ASC, so the LAST page is the newest.
    expect(lastMessagePage(0)).toBe(1);
    expect(lastMessagePage(1)).toBe(1);
    expect(lastMessagePage(20)).toBe(1);
    expect(lastMessagePage(21)).toBe(2);
    expect(lastMessagePage(100)).toBe(5);
    expect(lastMessagePage(101)).toBe(6);
  });

  it("initialises on the last page, never on page 1", () => {
    const messages = code("features/chat/messages.ts");
    expect(messages).toContain("initialPageParam: lastPage");
    expect(messages).not.toContain("initialPageParam: 1");
  });

  it("walks backwards for older messages", () => {
    expect(olderMessagePage(page([1], { page: 5 }))).toBe(4);
    expect(olderMessagePage(page([1], { page: 2 }))).toBe(1);
    // Page 1 is the beginning of the conversation; there is nothing older.
    expect(olderMessagePage(page([1], { page: 1 }))).toBeUndefined();
  });

  it("keeps the transcript chronological across pages", () => {
    const messages = code("features/chat/messages.ts");
    /*
     * Pages arrive newest-first while each page is internally oldest-first,
     * so only the PAGE order is reversed — reversing the messages themselves
     * would scramble every page.
     */
    expect(messages).toContain(".reverse()");
    expect(messages).toContain("flatMap((page) => page.data ?? [])");
  });

  it("keeps the two audience scopes apart", () => {
    expect(conversationBase("candidate")).toBe(
      "/candidate-account/me/conversations",
    );
    expect(conversationBase("recruiter")).toBe("/conversations");
  });
});

/* ------------------------------------------------------------------ */

describe("message merging is idempotent", () => {
  const message = (id: string): ChatMessage => ({
    id,
    conversationId: "c1",
    body: `body ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  it("ignores a message it already holds", () => {
    const current = [message("m1"), message("m2")];
    // Arrives twice: the POST reply and the socket echo.
    expect(mergeMessage(current, message("m2"))).toBe(current);
    expect(mergeMessage(current, message("m3"))).toHaveLength(3);
  });

  it("ignores an event with no id rather than rendering a blank row", () => {
    const current = [message("m1")];
    expect(mergeMessage(current, { ...message("x"), id: "" })).toBe(current);
  });

  it("files an arrival on the newest page, not the oldest", () => {
    const messages = code("features/chat/messages.ts");
    // Pages are newest-first, so the newest page is pages[0]. Appending to
    // the last entry would file a new message months in the past.
    expect(messages).toContain("const [newest, ...rest] = current.pages");
    expect(messages).toContain("pages: [{ ...newest, data: merged }, ...rest]");
  });
});

/* ------------------------------------------------------------------ */

describe("avatar upload", () => {
  it("posts multipart with the field name the backend reads", () => {
    const queries = code("features/profile/queries.ts");
    // `FileInterceptor('file')` — any other name arrives as no file at all.
    expect(queries).toContain('form.append("file"');
    expect(queries).toContain("/account/me/avatar");
  });

  it("offers only the image types the server accepts", () => {
    expect([...AVATAR_MIME_TYPES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
  });

  it("supports removing the picture, which the backend allows", () => {
    const queries = code("features/profile/queries.ts");
    expect(queries).toContain("useDeleteAvatar");
    expect(queries).toContain('method: "DELETE"');
  });

  it("refetches the account and the session after a change", () => {
    const queries = code("features/profile/queries.ts");
    expect(queries).toContain("queryKeys.session");
    expect(queries).toContain("queryKeys.candidate.account");
  });

  it("asks for permission at the point of use", () => {
    const screen = code("app/(candidate)/profile.tsx");
    expect(screen).toContain("requestMediaLibraryPermissionsAsync");
    expect(screen).toContain("d.profile.permissionNeeded");
  });
});

/* ------------------------------------------------------------------ */

describe("search evidence is not paginated", () => {
  it("sends a limit and never a page", () => {
    const candidates = code("features/recruiter/candidates.ts");
    const call = candidates.slice(candidates.indexOf('"/search/evidence"'));
    const body = call.slice(0, call.indexOf("}),"));
    expect(body).toContain("limit");
    // Sending `page` is a 400; there is no page 2 to fake.
    expect(body).not.toContain("page");
  });
});

/* ------------------------------------------------------------------ */

describe("Toss round-trip", () => {
  it("refetches billing after the browser closes, whatever it reported", () => {
    const billing = code("features/billing/queries.ts");
    expect(billing).toContain("onSettled");
    expect(billing).toContain("queryKeys.billing.summary");
    // A dismissed browser is not proof of payment.
    expect(billing).not.toMatch(/setQueryData[^;]*plan/);
  });

  it("never activates a plan locally", () => {
    const plans = code("app/(candidate)/plans.tsx");
    expect(plans).toContain("billing.data?.plan");
    expect(plans).not.toMatch(/setPlan|localPlan/);
  });

  it("handles no card data and carries no Toss secret", () => {
    for (const file of [
      "features/billing/queries.ts",
      "app/(candidate)/plans.tsx",
    ]) {
      expect(code(file)).not.toMatch(
        /cardNumber|cvc|expiry|secretKey|clientKey|tosspayments/i,
      );
    }
  });
});

/* ------------------------------------------------------------------ */

describe("socket follows the current token", () => {
  it("reconnects with the new token after a rotation", () => {
    const socket = code("lib/realtime/socket.ts");
    expect(socket).toContain("onAccessTokenChange");
    // `socket.auth` is read at each handshake, so it must be re-armed AND
    // the connection cycled — updating one without the other does nothing.
    expect(socket).toContain("socket.auth = { token: next }");
    expect(socket).toContain("socket.disconnect().connect()");
  });

  it("disconnects when the token is cleared", () => {
    const socket = code("lib/realtime/socket.ts");
    expect(socket).toMatch(/if \(!next\) \{\s*socket\.disconnect\(\);/);
  });

  it("announces every rotation from the one place tokens change", () => {
    const client = code("lib/api/client.ts");
    expect(client).toContain("announceToken");
    // Both a refresh (setSession) and a sign-out (endSession) must announce.
    const setSession = client.slice(client.indexOf("export async function setSession"));
    expect(setSession.slice(0, 200)).toContain("announceToken");
    const endSession = client.slice(client.indexOf("export async function endSession"));
    expect(endSession.slice(0, 250)).toContain("announceToken");
  });

  it("implements no realtime event the server does not support", () => {
    const socket = code("lib/realtime/socket.ts");
    for (const unsupported of ["typing", "delivered", "read.receipt", "seen"]) {
      expect(socket).not.toContain(unsupported);
    }
  });
});
