import { describe, expect, it } from "vitest";
import {
  readPageParam,
  readStatusParam,
} from "@/lib/candidate/external-list-params";

/**
 * Both list URLs are shareable, so both are user input.
 *
 * A hand-edited or mangled parameter must NARROW the request, never produce an
 * error page for whoever the link was sent to. A job seeker who receives a
 * broken link and sees a 400 has been failed by this product, not by whoever
 * shared it.
 */

describe("readPageParam", () => {
  it("reads a real page number", () => {
    expect(readPageParam({ page: "3" })).toBe(3);
  });

  it("defaults to the first page for anything unusable", () => {
    for (const page of ["0", "-2", "abc", "", "1.9e9999", undefined]) {
      expect(readPageParam({ page }), String(page)).toBeGreaterThanOrEqual(1);
    }
    expect(readPageParam({})).toBe(1);
    expect(readPageParam({ page: "abc" })).toBe(1);
    expect(readPageParam({ page: "0" })).toBe(1);
    expect(readPageParam({ page: "-2" })).toBe(1);
  });

  it("treats a repeated parameter as no selection rather than guessing", () => {
    expect(readPageParam({ page: ["2", "5"] })).toBe(1);
  });

  it("clamps past the backend's own ceiling instead of sending a 400", () => {
    expect(readPageParam({ page: "999999999" })).toBe(100_000);
  });

  it("ignores a fractional page rather than sending a non-integer", () => {
    // parseInt truncates, which is the narrowing behaviour we want.
    expect(readPageParam({ page: "2.7" })).toBe(2);
  });
});

describe("readStatusParam", () => {
  it("accepts every status the backend defines", () => {
    for (const status of ["APPLIED", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"]) {
      expect(readStatusParam({ status })).toBe(status);
    }
  });

  it("drops an unknown status to 'all' rather than sending a rejected value", () => {
    // A wider list the reader can see and correct beats a 400 they cannot.
    expect(readStatusParam({ status: "BANANA" })).toBeUndefined();
    expect(readStatusParam({ status: "applied" })).toBeUndefined();
    expect(readStatusParam({ status: ["APPLIED", "OFFER"] })).toBeUndefined();
    expect(readStatusParam({})).toBeUndefined();
  });
});
