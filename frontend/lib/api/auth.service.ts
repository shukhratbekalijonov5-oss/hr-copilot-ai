import { ApiError, mockRequest } from "@/lib/api/client";
import { currentUser, organization } from "@/lib/mock/seed/org";
import type { AuthSession, LoginInput, RegisterInput } from "@/lib/types";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Credentials are never validated in the frontend against a real store — the
 * mock only rejects a known-bad address so the error state is reachable.
 */
const REJECTED_EMAIL = "blocked@example.com";

function issueSession(): AuthSession {
  return {
    user: currentUser,
    organization,
    accessToken: "mock-session-token",
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
}

export async function login(input: LoginInput): Promise<AuthSession> {
  return mockRequest(() => {
    if (input.email.trim().toLowerCase() === REJECTED_EMAIL) {
      throw new ApiError("Email or password is incorrect.", 401);
    }
    return issueSession();
  }, 620);
}

export async function register(input: RegisterInput): Promise<AuthSession> {
  return mockRequest(() => {
    if (input.email.trim().toLowerCase() === REJECTED_EMAIL) {
      throw new ApiError("An account already exists for this email.", 409, {
        email: "An account already exists for this email.",
      });
    }
    return {
      ...issueSession(),
      user: { ...currentUser, fullName: input.fullName, email: input.email },
      organization: { ...organization, name: input.organizationName },
    };
  }, 780);
}

export async function getSession(): Promise<AuthSession> {
  return mockRequest(() => issueSession(), 0);
}
