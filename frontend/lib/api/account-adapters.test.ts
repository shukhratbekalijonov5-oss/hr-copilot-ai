import { describe, expect, it } from "vitest";
import { toAccountProfile, toOrganization, toSessionUser } from "@/lib/api/adapters";
import type { MeResponse, OrganizationResponse } from "@/lib/api/contracts";

/**
 * "No picture" is a state, not a missing value: it must reach the UI as an
 * explicit null so the avatar renders initials, and it must survive a backend
 * that omits the field entirely (an older deployment) rather than becoming
 * `undefined` and tripping a truthiness check somewhere downstream.
 */
describe("account adapters", () => {
  const me = (avatarUrl?: string | null): MeResponse =>
    ({
      id: "u1",
      email: "dana@northwind.test",
      fullName: "Dana Reed",
      accountType: "ORGANIZATION",
      preferredLocale: "en",
      role: null,
      organizationId: null,
      organization: null,
      user: {
        id: "u1",
        email: "dana@northwind.test",
        fullName: "Dana Reed",
        accountType: "ORGANIZATION",
        preferredLocale: "en",
        ...(avatarUrl === undefined ? {} : { avatarUrl }),
      },
      candidateAccount: { exists: false },
      activeOrganization: null,
      memberships: [],
    }) as MeResponse;

  it("carries the signed avatar URL into the session", () => {
    expect(toSessionUser(me("https://signed.example/a.png")).avatarUrl).toBe(
      "https://signed.example/a.png",
    );
  });

  it("reports an account with no picture as null", () => {
    expect(toSessionUser(me(null)).avatarUrl).toBeNull();
  });

  it("treats an omitted field as no picture, not as undefined", () => {
    expect(toSessionUser(me()).avatarUrl).toBeNull();
  });

  it("maps the account profile without exposing a storage key", () => {
    const profile = toAccountProfile({
      id: "u1",
      email: "dana@northwind.test",
      fullName: "Dana Reed",
      accountType: "CANDIDATE",
      preferredLocale: "ru",
      avatarUrl: null,
    });

    expect(profile).toEqual({
      id: "u1",
      email: "dana@northwind.test",
      fullName: "Dana Reed",
      accountType: "CANDIDATE",
      avatarUrl: null,
    });
    expect(profile).not.toHaveProperty("avatarStorageKey");
  });

  it("carries the organization URL, and its absence, through", () => {
    const base: OrganizationResponse = {
      id: "o1",
      name: "Northwind",
      slug: "northwind",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      toOrganization({ ...base, websiteUrl: "https://northwind.example" })
        .websiteUrl,
    ).toBe("https://northwind.example");
    expect(toOrganization(base).websiteUrl).toBeNull();
  });
});
