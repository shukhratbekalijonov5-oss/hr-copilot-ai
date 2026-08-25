import { apiFetch, endSession, setSession } from "@/lib/api/client";
import type { SessionUser, TokenPairResponse } from "@/types";

/**
 * The auth calls, exactly as the backend already defines them.
 *
 * No second auth system: these are the same endpoints the web client uses,
 * with the same bodies. Role and entitlements are never inferred on the
 * device — `me()` is the authority, and the router reads only its answer.
 */
export interface LoginInput {
  email: string;
  password: string;
  /** Which door the UI rendered; the backend refuses a mismatch. */
  accountType?: "CANDIDATE" | "ORGANIZATION";
}

export async function login(input: LoginInput): Promise<SessionUser> {
  const pair = await apiFetch<TokenPairResponse>("/auth/login", {
    method: "POST",
    body: input,
    anonymous: true,
  });
  await setSession(pair);
  // The tokens say nothing trustworthy about role — ask the server.
  return me();
}

export async function registerCandidate(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<SessionUser> {
  const pair = await apiFetch<TokenPairResponse>("/auth/register/candidate", {
    method: "POST",
    body: input,
    anonymous: true,
  });
  await setSession(pair);
  return me();
}

export async function registerOrganization(input: {
  email: string;
  password: string;
  fullName: string;
  organizationName: string;
}): Promise<SessionUser> {
  const pair = await apiFetch<TokenPairResponse>(
    "/auth/register/organization",
    { method: "POST", body: input, anonymous: true },
  );
  await setSession(pair);
  return me();
}

export function me(): Promise<SessionUser> {
  return apiFetch<SessionUser>("/auth/me");
}

/**
 * Ends the session on this device.
 *
 * The local clear happens whatever the server says: a network failure must
 * not leave somebody signed in on a phone they are trying to sign out of.
 * The server-side revoke is attempted first so the session really dies when
 * the device is online.
 */
export async function logout(): Promise<void> {
  try {
    await apiFetch<void>("/auth/logout", { method: "POST" });
  } catch {
    // Offline, or the token already expired. Clearing locally is still right.
  }
  await endSession();
}

export async function logoutEverywhere(): Promise<void> {
  try {
    await apiFetch<void>("/auth/logout-all", { method: "POST" });
  } catch {
    // Same rule as above.
  }
  await endSession();
}

export function listSessions(): Promise<unknown[]> {
  return apiFetch<unknown[]>("/auth/sessions");
}
