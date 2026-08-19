import type { FieldErrors } from "@/lib/api/client";
import type { LoginInput, RegisterInput } from "@/lib/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
  } else if (values.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  } else if (!/[a-zA-Z]/.test(values.password) || !/[0-9]/.test(values.password)) {
    errors.password = "Include at least one letter and one number.";
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
