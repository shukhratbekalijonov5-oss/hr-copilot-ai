import { describe, expect, it } from "vitest";
import {
  accountErrorMessage,
  accountFieldFor,
  validateProfileForm,
  validateWebsiteUrl,
} from "@/lib/account/validation";
import en from "@/lib/i18n/dictionaries/en";
import ko from "@/lib/i18n/dictionaries/ko";

/**
 * The rules the profile form enforces before a round trip. They mirror the
 * backend's `UpdateAccountProfileDto`; the backend remains the enforcement, so
 * what is asserted here is that the user is told which field to fix, and told
 * it in their own language.
 */
describe("validateProfileForm", () => {
  const valid = { fullName: "Dana Reed", email: "dana@northwind.test" };

  it("accepts a complete profile", () => {
    expect(validateProfileForm(valid)).toEqual({});
  });

  it("requires a name", () => {
    expect(validateProfileForm({ ...valid, fullName: "" }).fullName).toBe(
      en.validation.fullNameRequired,
    );
  });

  it("treats a whitespace-only name as blank, never as a name", () => {
    expect(validateProfileForm({ ...valid, fullName: "   " }).fullName).toBe(
      en.validation.fullNameRequired,
    );
  });

  it("requires a name long enough to be one", () => {
    expect(validateProfileForm({ ...valid, fullName: "D" }).fullName).toBe(
      en.validation.fullNameShort,
    );
  });

  it("requires an email", () => {
    expect(validateProfileForm({ ...valid, email: "  " }).email).toBe(
      en.validation.emailRequired,
    );
  });

  it("rejects a malformed email", () => {
    expect(validateProfileForm({ ...valid, email: "dana@" }).email).toBe(
      en.validation.emailInvalid,
    );
  });

  it("reports both fields at once rather than one at a time", () => {
    expect(validateProfileForm({ fullName: "", email: "" })).toEqual({
      fullName: en.validation.fullNameRequired,
      email: en.validation.emailRequired,
    });
  });

  it("speaks the caller's language", () => {
    expect(validateProfileForm({ fullName: "", email: "" }, ko).fullName).toBe(
      ko.validation.fullNameRequired,
    );
  });
});

/**
 * The organization URL is optional — blank is a valid answer that clears it —
 * so the only failures are addresses that are present and not addresses.
 */
describe("validateWebsiteUrl", () => {
  it("accepts blank, which clears the field", () => {
    expect(validateWebsiteUrl("")).toBeNull();
    expect(validateWebsiteUrl("   ")).toBeNull();
  });

  it("accepts http and https addresses", () => {
    expect(validateWebsiteUrl("https://northwind.example")).toBeNull();
    expect(validateWebsiteUrl("http://northwind.example/careers")).toBeNull();
  });

  it("rejects an address with no scheme", () => {
    expect(validateWebsiteUrl("northwind.example")).toBe(
      en.validation.websiteUrlInvalid,
    );
  });

  it("rejects a scheme that is not http(s)", () => {
    expect(validateWebsiteUrl("javascript:alert(1)")).toBe(
      en.validation.websiteUrlInvalid,
    );
  });

  it("rejects a hostname that is not one", () => {
    expect(validateWebsiteUrl("https://localhost")).toBe(
      en.validation.websiteUrlInvalid,
    );
  });
});

/**
 * "Already in use" can only come from the backend — no client knows which
 * addresses are taken — so it must arrive as a localized message under the
 * email field, not as English text at the top of the form.
 */
describe("backend rejections", () => {
  it("localizes the taken-address conflict", () => {
    expect(accountErrorMessage("EMAIL_ALREADY_IN_USE")).toBe(
      en.validation.emailInUse,
    );
    expect(accountErrorMessage("EMAIL_ALREADY_IN_USE", ko)).toBe(
      ko.validation.emailInUse,
    );
  });

  it("puts the conflict under the email field", () => {
    expect(accountFieldFor("EMAIL_ALREADY_IN_USE")).toBe("email");
  });

  it("localizes image rejections", () => {
    expect(accountErrorMessage("UNSUPPORTED_IMAGE_TYPE")).toBe(
      en.account.imageTypeError,
    );
    expect(accountErrorMessage("IMAGE_TOO_LARGE", ko)).toBe(
      ko.account.imageTooLarge,
    );
  });

  it("falls back rather than inventing copy for an unknown code", () => {
    expect(accountErrorMessage("SOMETHING_NEW")).toBeNull();
    expect(accountErrorMessage(null)).toBeNull();
    expect(accountFieldFor("SOMETHING_NEW")).toBeNull();
  });
});
