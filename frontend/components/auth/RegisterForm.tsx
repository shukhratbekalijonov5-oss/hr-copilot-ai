"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { registerAction } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH, hasErrors, validateRegister } from "@/lib/validation";
import type { FieldErrors } from "@/lib/api/errors";
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
    const validationErrors = validateRegister(values);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    startTransition(async () => {
      const result = await registerAction(values);
      setFormError(result.message ?? "Could not create the workspace.");
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Create your workspace
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          Sets up your organization and makes you its owner.
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
        label="Full name"
        name="fullName"
        autoComplete="name"
        placeholder="Jane Doe"
        required
        value={fullName}
        disabled={pending}
        leading={<UserIcon className="size-4" />}
        error={errors.fullName}
        onChange={(event) => setFullName(event.target.value)}
      />

      <Input
        label="Work email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="jane@company.com"
        required
        value={email}
        disabled={pending}
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        label="Company or organization"
        name="organizationName"
        autoComplete="organization"
        placeholder="Northwind Talent"
        required
        value={organizationName}
        disabled={pending}
        leading={<BuildingIcon className="size-4" />}
        error={errors.organizationName}
        onChange={(event) => handleOrganizationName(event.target.value)}
      />

      <Input
        label="Workspace URL"
        name="organizationSlug"
        placeholder="northwind-talent"
        required
        value={organizationSlug}
        disabled={pending}
        error={errors.organizationSlug}
        hint="Lowercase letters, numbers and hyphens. Must be unique."
        onChange={(event) => {
          setSlugTouched(true);
          setOrganizationSlug(event.target.value);
        }}
      />

      <Input
        label="Password"
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="new-password"
        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
        required
        value={password}
        disabled={pending}
        leading={<LockIcon className="size-4" />}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        onChange={(event) => setPassword(event.target.value)}
        trailing={
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
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
        {pending ? "Creating workspace" : "Create workspace"}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
