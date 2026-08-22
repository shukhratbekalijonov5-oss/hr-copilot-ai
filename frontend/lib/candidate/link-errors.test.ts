import { describe, expect, it } from "vitest";
import {
  isLinkErrorCode,
  isLinkFailureCode,
  linkFailureIsRetryable,
  localizedLinkError,
  localizedLinkFailure,
} from "@/lib/candidate/link-errors";
import { LINK_FAILURE_CODES } from "@/lib/types";
import { ALL_DICTIONARIES, getDictionary } from "@/lib/i18n/dictionary";

const d = getDictionary("en");

describe("localizedLinkError", () => {
  it("localizes on the CODE, not the backend's message", () => {
    expect(
      localizedLinkError("LINK_LIMIT_REACHED", d, "raw backend text"),
    ).toBe(d.candidateLinks.errorCodes.LINK_LIMIT_REACHED);
  });

  it("prefers the specific failure reason for a rejected URL", () => {
    // "That address is not reachable from the public internet" is far more
    // useful than a generic "invalid link".
    expect(
      localizedLinkError(
        "LINK_INVALID_URL",
        d,
        "fallback",
        "PRIVATE_NETWORK_URL",
      ),
    ).toBe(d.candidateLinks.failureCodes.PRIVATE_NETWORK_URL);
  });

  it("falls back to the generic invalid-URL copy without a failure code", () => {
    expect(localizedLinkError("LINK_INVALID_URL", d, "fallback")).toBe(
      d.candidateLinks.errorCodes.LINK_INVALID_URL,
    );
  });

  it("uses the caller's fallback for an unrecognised code", () => {
    expect(localizedLinkError("SOMETHING_NEW", d, "fallback")).toBe("fallback");
    expect(localizedLinkError(null, d, "fallback")).toBe("fallback");
  });

  it("never returns a raw backend message for a known code", () => {
    // A backend message can quote a hostname or an HTTP status; it must not
    // reach a candidate when we have real copy for the situation.
    for (const code of ["LINK_DUPLICATE", "LINK_BUSY", "LINK_NOT_RETRYABLE"]) {
      expect(localizedLinkError(code, d, "500 from example.com")).not.toContain(
        "example.com",
      );
    }
  });
});

describe("localizedLinkFailure", () => {
  it("has copy for every failure code the backend can produce", () => {
    for (const code of LINK_FAILURE_CODES) {
      const message = localizedLinkFailure(code, d);
      expect(message.length).toBeGreaterThan(10);
      // Operator vocabulary must never leak into candidate-facing copy. The
      // literal schemes are fine — telling someone their address must start
      // with https:// is advice; "SSRF" and "502" are internals.
      expect(message).not.toMatch(
        /SSRF|Qdrant|BullMQ|null|undefined|\b[45]\d{2}\b|status code|stack/i,
      );
    }
  });

  it("degrades to a neutral reason for an unknown code", () => {
    expect(localizedLinkFailure("SOMETHING_NEW", d)).toBe(
      d.candidateLinks.failureCodes.UPSTREAM_ERROR,
    );
  });

  it("is translated in every locale", () => {
    for (const { locale, dictionary } of ALL_DICTIONARIES) {
      for (const code of LINK_FAILURE_CODES) {
        const message = dictionary.candidateLinks.failureCodes[code];
        expect(message, `${locale}.${code}`).toBeTruthy();
        if (locale !== "en") {
          expect(message, `${locale}.${code}`).not.toBe(
            d.candidateLinks.failureCodes[code],
          );
        }
      }
    }
  });
});

describe("linkFailureIsRetryable", () => {
  it("offers Retry only where retrying could help", () => {
    expect(linkFailureIsRetryable("FETCH_TIMEOUT")).toBe(true);
    expect(linkFailureIsRetryable("UPSTREAM_ERROR")).toBe(true);
    expect(linkFailureIsRetryable("RENDER_FAILED")).toBe(true);
    expect(linkFailureIsRetryable("INDEXING_FAILED")).toBe(true);
    // Oversize is a state of the page (and of the backend's caps), not a
    // verdict on the URL — the backend accepts this retry too.
    expect(linkFailureIsRetryable("CONTENT_TOO_LARGE")).toBe(true);
  });

  it("hides Retry for failures that can never succeed", () => {
    // Mirrors the backend, which refuses these with a typed 409. A button
    // that cannot work is worse than no button.
    for (const code of [
      "PRIVATE_NETWORK_URL",
      "UNSUPPORTED_PROTOCOL",
      "INVALID_URL",
      "ACCESS_DENIED",
      "NO_MEANINGFUL_CONTENT",
      "TOO_MANY_REDIRECTS",
      "UNSUPPORTED_CONTENT_TYPE",
    ]) {
      expect(linkFailureIsRetryable(code), code).toBe(false);
    }
  });

  it("treats an unknown code as not retryable", () => {
    expect(linkFailureIsRetryable(null)).toBe(false);
    expect(linkFailureIsRetryable("SOMETHING_NEW")).toBe(false);
  });
});

describe("code guards", () => {
  it("recognise only the documented codes", () => {
    expect(isLinkErrorCode("LINK_DUPLICATE")).toBe(true);
    expect(isLinkErrorCode("LINK_WHATEVER")).toBe(false);
    expect(isLinkFailureCode("FETCH_TIMEOUT")).toBe(true);
    expect(isLinkFailureCode("FETCH_WHATEVER")).toBe(false);
  });
});
