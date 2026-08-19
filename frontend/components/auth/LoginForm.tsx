"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { loginAction } from "@/lib/auth/actions";
import { hasErrors, validateLogin } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/context";
import type { FieldErrors } from "@/lib/api/errors";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from "@/components/ui/icons";

export function LoginForm() {
  const { d } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards against a second submit while the first is in flight.
    if (pending) return;

    setFormError(null);
    const validationErrors = validateLogin({ email, password }, d);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    startTransition(async () => {
      // On success the action sets the session cookie and redirects, so
      // control never returns here.
      const result = await loginAction({ email, password });
      setFormError(result.message ?? d.auth.couldNotSignIn);
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {d.auth.signIn}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          {d.auth.signInSubtitle}
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
        label={d.auth.email}
        type="email"
        name="email"
        autoComplete="email"
        placeholder={d.auth.emailPlaceholder}
        required
        value={email}
        disabled={pending}
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        label={d.auth.password}
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        value={password}
        disabled={pending}
        leading={<LockIcon className="size-4" />}
        error={errors.password}
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
        {pending ? d.auth.signingIn : d.auth.signIn}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        {d.auth.noAccount}{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          {d.auth.createOne}
        </Link>
      </p>
    </form>
  );
}
