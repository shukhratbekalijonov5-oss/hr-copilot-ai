"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { hasErrors, validateLogin } from "@/lib/validation";
import type { FieldErrors } from "@/lib/api/client";
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
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const validationErrors = validateLogin({ email, password });
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    setSubmitting(true);
    try {
      await api.login({ email, password });
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

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Sign in
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          Use your work account to reach your organization&rsquo;s pipeline.
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
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        value={email}
        leading={<MailIcon className="size-4" />}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <Input
        label="Password"
        type={showPassword ? "text" : "password"}
        name="password"
        autoComplete="current-password"
        placeholder="••••••••"
        required
        value={password}
        leading={<LockIcon className="size-4" />}
        error={errors.password}
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
        {submitting ? "Signing in" : "Sign in"}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-brand hover:underline">
          Create one
        </Link>
      </p>
    </form>
  );
}
