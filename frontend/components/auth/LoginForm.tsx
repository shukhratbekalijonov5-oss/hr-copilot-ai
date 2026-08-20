"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { loginAction } from "@/lib/auth/actions";
import { loginRouteForAccountType } from "@/lib/auth/routing";
import { hasErrors, validateLogin } from "@/lib/validation";
import { useI18n } from "@/lib/i18n/context";
import type { FieldErrors } from "@/lib/api/errors";
import type { AccountType } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import {
  AlertIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MailIcon,
} from "@/components/ui/icons";

/**
 * Codes the backend attaches to a 401 on refresh.
 *
 * Keyed off the dictionary so a new code cannot be displayed without also being
 * translated; anything unrecognised falls back to the generic message rather
 * than showing a raw identifier to a person.
 */
type AuthErrorCode = Exclude<
  keyof ReturnType<typeof useI18n>["d"]["authErrors"],
  "generic"
>;

export function LoginForm({ accountType }: { accountType: AccountType }) {
  const { d } = useI18n();
  const params = useSearchParams();
  const next = params.get("next") ?? undefined;

  /**
   * Why the previous session ended, if it ended for a reason the backend
   * named. An unknown code falls back to the generic message rather than
   * showing a raw identifier.
   */
  const reason = params.get("reason");
  const endedMessage = reason
    ? (d.authErrors[reason as AuthErrorCode] ?? d.authErrors.generic)
    : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formCode, setFormCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const otherAccountType =
    accountType === "CANDIDATE" ? "ORGANIZATION" : "CANDIDATE";
  const mismatchMessage =
    accountType === "CANDIDATE"
      ? d.auth.organizationAccountUseOrganizationSignIn
      : d.auth.candidateAccountUseCandidateSignIn;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guards against a second submit while the first is in flight.
    if (pending) return;

    setFormError(null);
    setFormCode(null);
    const validationErrors = validateLogin({ email, password }, d);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;

    startTransition(async () => {
      // On success the action sets the session cookie and redirects, so
      // control never returns here.
      const result = await loginAction({ email, password, accountType }, next);
      setFormCode(result.code ?? null);
      setFormError(
        result.code === "AUTH_ACCOUNT_TYPE_MISMATCH"
          ? mismatchMessage
          : (result.message ?? d.auth.couldNotSignIn),
      );
      setErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {accountType === "CANDIDATE"
            ? d.auth.candidateSignIn
            : d.auth.organizationSignIn}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-muted">
          {accountType === "CANDIDATE"
            ? d.auth.candidateSignInSubtitle
            : d.auth.organizationSignInSubtitle}
        </p>
      </div>

      {endedMessage && !formError ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          {endedMessage}
        </p>
      ) : null}

      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="mt-px size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {formError}
            {formCode === "AUTH_ACCOUNT_TYPE_MISMATCH" ? (
              <Link
                href={loginRouteForAccountType(otherAccountType)}
                className="ml-1 font-medium underline underline-offset-2"
              >
                {accountType === "CANDIDATE"
                  ? d.auth.organizationSignIn
                  : d.auth.candidateSignIn}
              </Link>
            ) : null}
          </span>
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
        {pending
          ? d.auth.signingIn
          : accountType === "CANDIDATE"
            ? d.auth.candidateSignIn
            : d.auth.organizationSignIn}
      </Button>

      <p className="text-center text-[13px] text-ink-muted">
        {d.auth.noAccount}{" "}
        <Link
          href={
            accountType === "CANDIDATE"
              ? "/register/candidate"
              : "/register/organization"
          }
          className="font-medium text-brand hover:underline"
        >
          {accountType === "CANDIDATE"
            ? d.auth.createCandidateAccount
            : d.auth.createOrganizationAccount}
        </Link>
      </p>
    </form>
  );
}
