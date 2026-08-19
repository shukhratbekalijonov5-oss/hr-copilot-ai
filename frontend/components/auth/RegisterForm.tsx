"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { hasErrors, isConsumerEmail, validateRegister } from "@/lib/validation";
import type { FieldErrors } from "@/lib/api/client";
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
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const values = { fullName, email, organizationName, password };
    const validationErrors = validateRegister(values);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    setSubmitting(true);
    try {
      await api.register(values);
      router.push("/dashboard");
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setErrors(error.fieldErrors);
      } else {
        setFormError("Something went wrong. Try again.");
      }
      setSubmitting(false);
    }
  }

  const emailHint =
    email && isConsumerEmail(email)
      ? "This looks like a personal address. A work email keeps your team on one workspace."
      : "We use this to group your team into one workspace.";

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Create your workspace
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          Set up an organization and start uploading resumes in a few minutes.
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
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        hint={emailHint}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        label="Company or organization"
        name="organizationName"
        autoComplete="organization"
        placeholder="Northwind Talent"
        required
        value={organizationName}
        leading={<BuildingIcon className="size-4" />}
        error={errors.organizationName}
        onChange={(event) => setOrganizationName(event.target.value)}
      />

      <Input
        label="Password"
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="new-password"
        placeholder="At least 8 characters"
        required
        value={password}
        leading={<LockIcon className="size-4" />}
        error={errors.password}
        hint="At least 8 characters, including a letter and a number."
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

      <Button type="submit" size="lg" loading={submitting}>
        {submitting ? "Creating workspace" : "Create workspace"}
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
