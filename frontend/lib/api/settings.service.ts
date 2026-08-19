import { mockRequest } from "@/lib/api/client";
import {
  aiPreferences,
  currentUser,
  organization,
  securitySettings,
  team,
} from "@/lib/mock/seed/org";
import type {
  AiPreferences,
  Organization,
  SettingsData,
  User,
} from "@/lib/types";

const state: SettingsData = {
  user: { ...currentUser },
  organization: { ...organization },
  team,
  ai: { ...aiPreferences },
  security: { ...securitySettings },
};

export async function getSettings(): Promise<SettingsData> {
  return mockRequest(() => state);
}

export async function updateProfile(
  input: Pick<User, "fullName" | "email" | "jobTitle">,
): Promise<User> {
  return mockRequest(() => {
    state.user = { ...state.user, ...input };
    return state.user;
  }, 520);
}

export async function updateOrganization(
  input: Pick<Organization, "name" | "industry" | "companySize" | "website">,
): Promise<Organization> {
  return mockRequest(() => {
    state.organization = { ...state.organization, ...input };
    return state.organization;
  }, 520);
}

export async function updateAiPreferences(
  input: AiPreferences,
): Promise<AiPreferences> {
  return mockRequest(() => {
    state.ai = { ...input };
    return state.ai;
  }, 420);
}
