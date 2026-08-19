"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { registerAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, hasErrors, validateRegister } from "@/lib/validation";
import type { FieldErrors } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/context";
import { slugify } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import {
  AlertIcon,
  BuildingIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
  UserIcon,
} from "@/components/ui/icons";

export function RegisterForm() {
  const { d, f } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  // Auto-derived from the name until the user edits it themselves.
  const [slugTouched, setSlugTouched] = useState(false);
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleOrganizationName(value: string) {
    setOrganizationName(value);
    if (!slugTouched) setOrganizationSlug(slugify(value));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setFormError(null);
    const values = {
      fullName,
      email,
      organizationName,
      organizationSlug,
      password,
    };
    const validationErrors = validateRegister(values, d);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    startTransition(async () => {
      const result = await registerAction(values);
      setFormError(result.message ?? d.auth.couldNotRegister);
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {d.auth.createAccount}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          {d.register.subtitle}
        </p>
      </div>

      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {formError}
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
        label={d.register.workEmail}
        type="email"
        name="email"
        autoComplete="email"
        placeholder={d.register.workEmailPlaceholder}
        required
        value={email}
        disabled={pending}
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />

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
        {pending ? d.register.submitting : d.register.submit}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        {d.auth.haveAccount}{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          {d.auth.signInInstead}
        </Link>
      </p>
    </form>
  );
}
