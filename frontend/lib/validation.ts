import type { FieldErrors } from "@/lib/api/errors";
import type { LoginInput, RegisterInput } from "@/lib/types";

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

export function validateLogin(values: LoginInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.email.trim()) {
    errors.email = "Email is required.";
  } else if (!isValidEmail(values.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  }

  return errors;
}

export function validateRegister(values: RegisterInput): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.fullName.trim()) {
    errors.fullName = "Full name is required.";
  } else if (values.fullName.trim().length < 2) {
    errors.fullName = "Enter your full name.";
  }

  if (!values.email.trim()) {
    errors.email = "Work email is required.";
  } else if (!isValidEmail(values.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!values.organizationName.trim()) {
    errors.organizationName = "Company or organization name is required.";
  }

  if (!values.password) {
    errors.password = "Password is required.";
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (!values.organizationSlug.trim()) {
    errors.organizationSlug = "Workspace URL is required.";
  } else if (!SLUG_PATTERN.test(values.organizationSlug.trim())) {
    errors.organizationSlug =
      "Use lowercase letters, numbers and hyphens only.";
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
