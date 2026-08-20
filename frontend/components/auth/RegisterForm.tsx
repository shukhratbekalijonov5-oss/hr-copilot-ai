"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { registerAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, hasErrors, validateRegister } from "@/lib/validation";
import type { FieldErrors } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/context";
import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n/locales";
import { slugify } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import {
  AlertIcon,
  BuildingIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from "@/components/ui/icons";
import type { AccountType } from "@/lib/types";

export function RegisterForm({ accountType }: { accountType: AccountType }) {
  const { d, f, locale } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  // Auto-derived from the name until the user edits it themselves.
  const [slugTouched, setSlugTouched] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [preferredLocale, setPreferredLocale] = useState<Locale>(locale);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formCode, setFormCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isOrganization = accountType === "ORGANIZATION";

  function handleOrganizationName(value: string) {
    setOrganizationName(value);
    if (!slugTouched) setOrganizationSlug(slugify(value));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    setFormCode(null);
    const values = {
      fullName,
      email,
      ...(isOrganization ? { organizationName, organizationSlug } : {}),
      preferredLocale,
      password,
    };
    const validationErrors = validateRegister(values, d);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    startTransition(async () => {
      const result = await registerAction(values, accountType);
      setFormCode(result.code ?? null);
      setFormError(
        localizedRegistrationError(result.code, accountType, d) ??
          result.message ??
          d.auth.couldNotRegister,
      );
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {isOrganization
            ? d.auth.createOrganizationAccount
            : d.auth.createCandidateAccount}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          {isOrganization
            ? d.register.organizationSubtitle
            : d.register.candidateSubtitle}
        </p>
      </div>

      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {formError}
            {formCode === "AUTH_ACCOUNT_TYPE_CONFLICT" ? (
              <Link
                href={
                  isOrganization ? "/login/candidate" : "/login/organization"
                }
                className="ml-1 font-medium underline underline-offset-2"
              >
                {isOrganization ? d.auth.candidateSignIn : d.auth.organizationSignIn}
              </Link>
            ) : null}
          </span>
        </p>
      ) : null}

      <Input
        label={d.auth.fullName}
        name="fullName"
        autoComplete="name"
        placeholder={d.register.fullNamePlaceholder}
        required
        value={fullName}
        disabled={pending}
        leading={<UserIcon className="size-4" />}
        error={errors.fullName}
        onChange={(event) => setFullName(event.target.value)}
      />

      <Input
        label={isOrganization ? d.register.workEmail : d.auth.email}
        type="email"
        name="email"
        autoComplete="email"
        placeholder={
          isOrganization
            ? d.register.workEmailPlaceholder
            : d.auth.emailPlaceholder
        }
        required
        value={email}
        disabled={pending}
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />

      {isOrganization ? (
        <>
          <Input
            label={d.register.organizationLabel}
            name="organizationName"
            autoComplete="organization"
            placeholder={d.register.organizationPlaceholder}
            required
            value={organizationName}
            disabled={pending}
            leading={<BuildingIcon className="size-4" />}
            error={errors.organizationName}
            onChange={(event) => handleOrganizationName(event.target.value)}
          />

          <Input
            label={d.register.slugLabel}
            name="organizationSlug"
            placeholder={d.register.slugPlaceholder}
            required
            value={organizationSlug}
            disabled={pending}
            error={errors.organizationSlug}
            hint={d.register.slugHint}
            onChange={(event) => {
              setSlugTouched(true);
              setOrganizationSlug(event.target.value);
            }}
          />
        </>
      ) : null}

      <Select
        label={d.register.preferredLanguage}
        name="preferredLocale"
        value={preferredLocale}
        disabled={pending}
        options={LOCALES.map((item) => ({
          value: item,
          label: LOCALE_META[item].label,
        }))}
        onChange={(event) => setPreferredLocale(event.target.value as Locale)}
      />

      <Input
        label={d.auth.password}
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="new-password"
        placeholder={f(d.register.passwordPlaceholder, { min: MIN_PASSWORD_LENGTH })}
        required
        value={password}
        disabled={pending}
        leading={<LockIcon className="size-4" />}
        error={errors.password}
        hint={f(d.register.passwordHint, { min: MIN_PASSWORD_LENGTH })}
        onChange={(event) => setPassword(event.target.value)}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? d.auth.hidePassword : d.auth.showPassword}
            className="rounded p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
          >
            {showPassword ? (
              <EyeOffIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
          </button>
        }
      />

      <Button type="submit" size="lg" loading={pending}>
        {pending
          ? isOrganization
            ? d.register.submittingOrganization
            : d.register.submittingCandidate
          : isOrganization
            ? d.register.submitOrganization
            : d.register.submitCandidate}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        {d.auth.haveAccount}{" "}
        <Link
          href={isOrganization ? "/login/organization" : "/login/candidate"}
          className="font-medium text-brand hover:underline"
        >
          {isOrganization ? d.auth.organizationSignIn : d.auth.candidateSignIn}
        </Link>
      </p>
    </form>
  );
}

function localizedRegistrationError(
  code: string | null | undefined,
  accountType: AccountType,
  d: ReturnType<typeof useI18n>["d"],
): string | null {
  if (code === "AUTH_EMAIL_ALREADY_REGISTERED") {
    return d.auth.emailAlreadyRegistered;
  }
  if (code !== "AUTH_ACCOUNT_TYPE_CONFLICT") return null;
  return accountType === "CANDIDATE"
    ? d.auth.emailBelongsToOrganization
    : d.auth.emailBelongsToCandidate;
}
