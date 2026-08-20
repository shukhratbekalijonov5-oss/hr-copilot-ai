import type { LoginInput, RegisterInput } from "@/lib/types";

export function loginPayload(input: LoginInput) {
  return {
    email: input.email.trim(),
    password: input.password,
    accountType: input.accountType,
    deviceName: input.deviceName,
  };
}

function sharedRegistrationPayload(input: RegisterInput) {
  return {
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    password: input.password,
    preferredLocale: input.preferredLocale,
    deviceName: input.deviceName,
  };
}

export function candidateRegistrationPayload(input: RegisterInput) {
  return sharedRegistrationPayload(input);
}

export function organizationRegistrationPayload(input: RegisterInput) {
  return {
    ...sharedRegistrationPayload(input),
    organizationName: input.organizationName?.trim(),
    organizationSlug: input.organizationSlug?.trim(),
  };
}
