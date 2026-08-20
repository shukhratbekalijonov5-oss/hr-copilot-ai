import { describe, expect, it } from "vitest";
import {
  candidateRegistrationPayload,
  loginPayload,
  organizationRegistrationPayload,
} from "@/lib/api/auth-payloads";

describe("auth payloads", () => {
  it("sends candidate accountType from the candidate sign-in door", () => {
    expect(
      loginPayload({
        email: " jasur@example.test ",
        password: "DevPassword123!",
        accountType: "CANDIDATE",
      }),
    ).toMatchObject({
      email: "jasur@example.test",
      accountType: "CANDIDATE",
    });
  });

  it("sends organization accountType from the organization sign-in door", () => {
    expect(
      loginPayload({
        email: "hr@example.test",
        password: "DevPassword123!",
        accountType: "ORGANIZATION",
      }),
    ).toMatchObject({ accountType: "ORGANIZATION" });
  });

  it("builds the candidate registration DTO without organization fields", () => {
    expect(
      candidateRegistrationPayload({
        fullName: " Jasur Toshmatov ",
        email: " jasur@example.test ",
        password: "DevPassword123!",
        preferredLocale: "uz",
        organizationName: "Should Not Ship",
        organizationSlug: "should-not-ship",
      }),
    ).toEqual({
      fullName: "Jasur Toshmatov",
      email: "jasur@example.test",
      password: "DevPassword123!",
      preferredLocale: "uz",
      deviceName: undefined,
    });
  });

  it("builds the organization registration DTO with required organization fields", () => {
    expect(
      organizationRegistrationPayload({
        fullName: " Mina Kim ",
        email: " mina@northwind.test ",
        password: "DevPassword123!",
        preferredLocale: "ko",
        organizationName: " Northwind Talent ",
        organizationSlug: " northwind-talent ",
      }),
    ).toEqual({
      fullName: "Mina Kim",
      email: "mina@northwind.test",
      password: "DevPassword123!",
      preferredLocale: "ko",
      deviceName: undefined,
      organizationName: "Northwind Talent",
      organizationSlug: "northwind-talent",
    });
  });
});
