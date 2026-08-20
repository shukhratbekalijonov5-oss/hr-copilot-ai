import en from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type { LoginInput, RegisterInput } from "@/lib/types";

/**
 * Messages come from the caller's dictionary.
 *
 * The parameter defaults to English so this module stays usable from plain
 * unit tests, and so a caller that forgets to pass one gets readable text
 * rather than a raw key on screen. Components always pass the active
 * dictionary from `useI18n()`.
 *
 * The English dictionary is imported directly rather than through the locale
 * registry, so importing a validator never pulls all four locales into a
 * bundle.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Matches the backend's RegisterDto slug rule exactly. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Backend InviteUserDto/RegisterDto require at least 12 characters. */
export const MIN_PASSWORD_LENGTH = 12;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Free-mail domains get a hint, never a hard block. */
const CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "mail.ru",
]);

export function isConsumerEmail(value: string): boolean {
  const domain = value.trim().toLowerCase().split("@")[1];
  return domain ? CONSUMER_DOMAINS.has(domain) : false;
}

export function validateLogin(
  values: LoginInput,
  d: Dictionary = en,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.email.trim()) {
    errors.email = d.validation.emailRequired;
  } else if (!isValidEmail(values.email)) {
    errors.email = d.validation.emailInvalid;
  }

  if (!values.password) {
    errors.password = d.validation.passwordRequired;
  }

  return errors;
}

export function validateRegister(
  values: RegisterInput,
  d: Dictionary = en,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.fullName.trim()) {
    errors.fullName = d.validation.fullNameRequired;
  } else if (values.fullName.trim().length < 2) {
    errors.fullName = d.validation.fullNameShort;
  }

  if (!values.email.trim()) {
    errors.email = d.validation.workEmailRequired;
  } else if (!isValidEmail(values.email)) {
    errors.email = d.validation.emailInvalid;
  }

  /**
   * Organization fields are validated only when the person is creating one.
   *
   * Registration serves two intents through one endpoint: a job seeker omits
   * both fields entirely. Mirrors the backend, which rejects a half-filled
   * pair and accepts an empty one.
   */
  const wantsOrganization =
    values.organizationName !== undefined ||
    values.organizationSlug !== undefined;

  if (wantsOrganization && !values.organizationName?.trim()) {
    errors.organizationName = d.validation.organizationNameRequired;
  }

  if (!values.password) {
    errors.password = d.validation.passwordRequired;
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = format(d.validation.passwordMinLength, {
      min: MIN_PASSWORD_LENGTH,
    });
  }

  if (wantsOrganization) {
    if (!values.organizationSlug?.trim()) {
      errors.organizationSlug = d.validation.slugRequired;
    } else if (!SLUG_PATTERN.test(values.organizationSlug.trim())) {
      errors.organizationSlug = d.validation.slugPattern;
    }
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
