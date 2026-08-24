/**
 * Validation and formatting for the DEMO checkout card form.
 *
 * These values never leave the browser. Nothing here serialises, stores or
 * transmits a card — the functions take strings and answer whether the form
 * LOOKS complete, which is the entire job of a demo checkout. The real
 * payment path is the Toss redirect, which never sees these fields either.
 *
 * Kept pure and outside the component so the rules are testable without a DOM
 * and so no card value can accidentally end up in component-level state that
 * outlives the modal.
 */

export const CARD_FIELDS = ["cardholder", "number", "expiry", "cvc"] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export type CardFieldError = "required" | "invalid";
export type CardErrors = Partial<Record<CardField, CardFieldError>>;

export interface CardFormValues {
  cardholder: string;
  number: string;
  expiry: string;
  cvc: string;
}

/** An empty form — also what the modal resets to on close and on success. */
export const EMPTY_CARD_FORM: CardFormValues = {
  cardholder: "",
  number: "",
  expiry: "",
  cvc: "",
};

/** Digits, grouped in fours, capped at the longest real PAN. */
export function formatCardNumber(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})(?=.)/g, "$1 ");
}

/** `MM/YY`, inserting the slash as soon as a month is complete. */
export function formatExpiry(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function formatCvc(input: string): string {
  return input.replace(/\D/g, "").slice(0, 4);
}

/**
 * Shape checks only — no network detection, no Luhn, no expiry-in-the-past
 * rule. A demo form that rejects a made-up card would be worse than one that
 * accepts it, and none of this is a security boundary.
 */
export function validateCardForm(values: CardFormValues): CardErrors {
  const errors: CardErrors = {};

  if (values.cardholder.trim().length === 0) {
    errors.cardholder = "required";
  }

  const number = values.number.trim();
  if (number.length === 0) {
    errors.number = "required";
  } else if (!/^[0-9 ]+$/.test(number) || !isCardLength(number)) {
    errors.number = "invalid";
  }

  const expiry = values.expiry.trim();
  if (expiry.length === 0) {
    errors.expiry = "required";
  } else if (!isExpiryShape(expiry)) {
    errors.expiry = "invalid";
  }

  const cvc = values.cvc.trim();
  if (cvc.length === 0) {
    errors.cvc = "required";
  } else if (!/^\d{3,4}$/.test(cvc)) {
    errors.cvc = "invalid";
  }

  return errors;
}

export function isCardFormValid(values: CardFormValues): boolean {
  return Object.keys(validateCardForm(values)).length === 0;
}

function isCardLength(number: string): boolean {
  const digits = number.replace(/\s/g, "").length;
  return digits >= 13 && digits <= 19;
}

function isExpiryShape(expiry: string): boolean {
  const match = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!match) return false;
  const month = Number(match[1]);
  return month >= 1 && month <= 12;
}
