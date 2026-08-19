import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  hasErrors,
  validateLogin,
  validateRegister,
} from "@/lib/validation";
import { slugify } from "@/lib/utils";

const validRegistration = {
  fullName: "Aziza Rakhimova",
  email: "aziza@northwind.example",
  password: "verysecurepassword123",
  organizationName: "Northwind Talent",
  organizationSlug: "northwind-talent",
};

describe("validateLogin", () => {
  it("requires both fields", () => {
    const errors = validateLogin({ email: "", password: "" });
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });

  it("accepts a well-formed sign-in", () => {
    expect(
      hasErrors(validateLogin({ email: "a@b.co", password: "whatever" })),
    ).toBe(false);
  });
});

describe("validateRegister", () => {
  it("accepts a valid registration", () => {
    expect(hasErrors(validateRegister(validRegistration))).toBe(false);
  });

  it("enforces the backend's minimum password length", () => {
    const errors = validateRegister({
      ...validRegistration,
      password: "a".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(errors.password).toBeDefined();
  });

  it("rejects a slug the backend's pattern would refuse", () => {
    for (const slug of ["Northwind Talent", "-leading", "trailing-", "UPPER"]) {
      expect(
        validateRegister({ ...validRegistration, organizationSlug: slug })
          .organizationSlug,
      ).toBeDefined();
    }
  });
});

describe("slugify", () => {
  it("produces slugs the backend accepts", () => {
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    expect(slugify("Northwind Talent")).toBe("northwind-talent");
    expect(pattern.test(slugify("  Acme & Co.  "))).toBe(true);
    expect(pattern.test(slugify("Tashkent — HR 2026"))).toBe(true);
  });

  it("stays within the 60-character limit", () => {
    expect(slugify("a".repeat(120)).length).toBeLessThanOrEqual(60);
  });
});
