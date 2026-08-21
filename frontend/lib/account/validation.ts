import en from "@/lib/i18n/dictionaries/en";
import { isValidEmail } from "@/lib/validation";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";

/**
 * Client-side rules for the profile form, mirroring the backend's
 * `UpdateAccountProfileDto` exactly.
 *
 * This is a courtesy, not the enforcement: the backend rejects the same values
 * whatever the browser does, and the "already in use" answer can only come
 * from there — no client can know which addresses are taken. What this buys is
 * a field-level message before a round trip.
 *
 * Same rules for both account types on purpose: an HR user and a job seeker
 * have the same required name and the same required sign-in address, so a
 * divergence here would be a bug rather than a product difference.
 */

/** Matches the DTO's `@MinLength(2)` on a trimmed name. */
export const MIN_NAME_LENGTH = 2;

export interface ProfileFormValues {
  fullName: string;
  email: string;
}

export function validateProfileForm(
  values: ProfileFormValues,
  d: Dictionary = en,
): FieldErrors {
  const errors: FieldErrors = {};

  // Trimmed, so "   " is blank rather than a three-character name.
  const fullName = values.fullName.trim();
  if (!fullName) {
    errors.fullName = d.validation.fullNameRequired;
  } else if (fullName.length < MIN_NAME_LENGTH) {
    errors.fullName = d.validation.fullNameShort;
  }

  const email = values.email.trim();
  if (!email) {
    errors.email = d.validation.emailRequired;
  } else if (!isValidEmail(email)) {
    errors.email = d.validation.emailInvalid;
  }

  return errors;
}

/**
 * The organization's public address. Optional — blank is valid and clears the
 * field — but a value that is present must be a real http(s) URL, matching the
 * backend's `@IsUrl({ protocols: ['http','https'], require_protocol: true })`.
 */
export function validateWebsiteUrl(
  value: string,
  d: Dictionary = en,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return d.validation.websiteUrlInvalid;
    }
    // `new URL("https://")` parses; a hostname-less address is not an address.
    if (!url.hostname.includes(".")) return d.validation.websiteUrlInvalid;
    return null;
  } catch {
    return d.validation.websiteUrlInvalid;
  }
}

/**
 * Backend `code` → localized copy.
 *
 * Localizing on the stable code rather than the English sentence is what keeps
 * a Korean user from seeing an English rejection. Anything unmapped falls back
 * to the caller's generic message.
 */
export function accountErrorMessage(
  code: string | null | undefined,
  d: Dictionary = en,
): string | null {
  switch (code) {
    case "EMAIL_ALREADY_IN_USE":
      return d.validation.emailInUse;
    case "UNSUPPORTED_IMAGE_TYPE":
      return d.account.imageTypeError;
    case "IMAGE_TOO_LARGE":
      return d.account.imageTooLarge;
    default:
      return null;
  }
}

/**
 * Which field a backend rejection belongs to, so the message lands under the
 * input the user must fix rather than at the top of the form.
 */
export function accountFieldFor(code: string | null | undefined): string | null {
  return code === "EMAIL_ALREADY_IN_USE" ? "email" : null;
}
