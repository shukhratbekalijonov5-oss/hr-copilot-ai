import { z } from "zod";

/**
 * Client-side validation is UX, not authority.
 *
 * These rules exist so somebody does not wait for a round trip to learn they
 * left a field blank. The backend re-validates everything and its answer is
 * the one that counts — which is why the password rule here is a bare
 * minimum length rather than a copy of the server's policy, that would drift.
 */
export const signInSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});

export type SignInValues = z.infer<typeof signInSchema>;

/**
 * Registration.
 *
 * Same principle: enough to catch a blank field before a round trip, and
 * deliberately NOT a copy of the backend's password policy. Two copies of one
 * rule drift, and the copy on the device is the one that cannot be fixed
 * without a store release.
 */
const registerFields = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().trim().min(1).email(),
  password: z.string().min(8),
  /*
   * Always present in the FORM, required only for an organization.
   *
   * Making it optional in the type instead would give the two doors two
   * different value shapes, and the form would have to be rebuilt — losing
   * whatever was typed — every time somebody switched tabs to look.
   */
  organizationName: z.string(),
});

export type RegisterValues = z.infer<typeof registerFields>;

export function registerSchemaFor(accountType: "CANDIDATE" | "ORGANIZATION") {
  return registerFields.superRefine((values, ctx) => {
    if (
      accountType === "ORGANIZATION" &&
      values.organizationName.trim().length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["organizationName"],
        message: "Organization name is required.",
      });
    }
  });
}
