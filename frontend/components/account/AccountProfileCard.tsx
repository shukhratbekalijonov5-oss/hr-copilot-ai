"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteAvatarAction,
  refreshAfterAvatarUploadAction,
  updateAccountProfileAction,
} from "@/lib/account/actions";
import {
  accountErrorMessage,
  accountFieldFor,
  validateProfileForm,
} from "@/lib/account/validation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { AlertIcon, CheckIcon, TrashIcon, UploadIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { FieldErrors } from "@/lib/api/errors";
import type { AccountProfileInput } from "@/lib/types";

/**
 * Name, sign-in address and profile picture — the identity half of a profile,
 * shared by the recruiter settings screen and the job seeker's own profile.
 *
 * One component because it is one account: both sides edit the same `users`
 * row through the same endpoint, and a second copy would drift the moment
 * either gained a rule. The surrounding screens keep their own layout; this
 * only owns the fields.
 *
 * The picture is optional throughout. "No picture" is a normal state that
 * renders as initials, so Remove is offered only when there is something to
 * remove, and removing one never touches the account it belonged to.
 */
export interface AccountProfileCardProps {
  user: { id: string; fullName: string; email: string; avatarUrl: string | null };
  /** Rendered under the avatar — e.g. the caller's role and organization. */
  subtitle?: string;
}

export function AccountProfileCard({ user, subtitle }: AccountProfileCardProps) {
  const { d } = useI18n();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  // Mirrors the server value so the preview updates the instant an upload or a
  // removal succeeds, without waiting for the re-render to arrive.
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [photoPending, setPhotoPending] = useState(false);

  const busy = pending || photoPending;

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const values = { fullName: fullName.trim(), email: email.trim() };
    const errors = validateProfileForm(values, d);
    setSaved(false);
    setError(null);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Send only what actually changed, so re-saving an unchanged address does
    // not ask the backend to re-check its own uniqueness.
    const input: AccountProfileInput = {};
    if (values.fullName !== user.fullName) input.fullName = values.fullName;
    if (values.email !== user.email) input.email = values.email;

    startTransition(async () => {
      const result = await updateAccountProfileAction(input);
      if (!result.ok) {
        const localized = accountErrorMessage(result.code, d);
        const field = accountFieldFor(result.code);
        if (localized && field) {
          setFieldErrors({ [field]: localized });
        } else {
          setError(localized ?? result.message ?? d.account.saveFailed);
        }
        return;
      }
      if (result.data) {
        setFullName(result.data.fullName);
        setEmail(result.data.email);
      }
      setSaved(true);
      router.refresh();
    });
  }

  async function uploadPhoto(file: File) {
    setSaved(false);
    setError(null);
    setPhotoPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/account/avatar", {
        method: "POST",
        body,
      });
      const payload: { avatarUrl?: string | null; code?: string; message?: string } =
        await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          accountErrorMessage(payload.code, d) ??
            payload.message ??
            d.account.photoFailed,
        );
        return;
      }
      setAvatarUrl(payload.avatarUrl ?? null);
      // Re-renders the shell so the header shows the new picture too.
      await refreshAfterAvatarUploadAction();
      router.refresh();
    } catch {
      setError(d.account.photoFailed);
    } finally {
      setPhotoPending(false);
      // Clearing the input is what lets the SAME file be chosen again after a
      // failure — otherwise `change` never fires a second time.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removePhoto() {
    if (busy) return;
    setSaved(false);
    setError(null);
    setPhotoPending(true);
    void deleteAvatarAction()
      .then((result) => {
        if (!result.ok) {
          setError(result.message ?? d.account.photoFailed);
          return;
        }
        setAvatarUrl(null);
        router.refresh();
      })
      .finally(() => setPhotoPending(false));
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
        >
          <AlertIcon className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={fullName || email} src={avatarUrl} size="xl" />

        <div className="flex min-w-0 flex-col gap-2">
          {subtitle ? (
            <p className="text-[12.5px] text-ink-muted">{subtitle}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<UploadIcon className="size-4" />}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {avatarUrl ? d.account.changePhoto : d.account.uploadPhoto}
            </Button>
            {/* Offered only when there is something to remove. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={<TrashIcon className="size-4" />}
              disabled={busy || !avatarUrl}
              onClick={removePhoto}
            >
              {d.account.removePhoto}
            </Button>
          </div>
          <p className="text-[12px] text-ink-subtle">{d.account.photoHint}</p>
        </div>

        <input
          ref={fileInput}
          type="file"
          // A hint to the picker only — the backend decides what is an image,
          // by magic number, and this attribute is trivially bypassed.
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadPhoto(file);
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={d.account.fullName}
          value={fullName}
          required
          disabled={busy}
          error={fieldErrors.fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <Input
          label={d.account.email}
          type="email"
          value={email}
          required
          disabled={busy}
          error={fieldErrors.email}
          hint={d.account.emailHint}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={pending} disabled={busy}>
          {d.account.saveChanges}
        </Button>
        {saved && !busy ? (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-[12.5px] text-positive"
          >
            <CheckIcon className="size-3.5" />
            {d.common.saved}
          </span>
        ) : null}
      </div>
    </form>
  );
}
