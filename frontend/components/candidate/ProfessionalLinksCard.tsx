"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCandidateLinkAction,
  deleteCandidateLinkAction,
  reprocessCandidateLinkAction,
  updateCandidateLinkAction,
} from "@/app/(candidate)/actions";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Field";
import { LinkStatusBadge } from "@/components/ui/StatusBadge";
import {
  AlertIcon,
  GlobeIcon,
  PlusIcon,
  RefreshIcon,
} from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import {
  linkFailureIsRetryable,
  localizedLinkError,
  localizedLinkFailure,
} from "@/lib/candidate/link-errors";
import { displayUrl } from "@/lib/utils";
import type { CandidateLink, CandidateLinkCollection } from "@/lib/types";

/**
 * The candidate's professional links — the other half of their evidence.
 *
 * Deliberately sits beside the files card in the profile, not behind a
 * settings screen: files and links are one "here is what I can show you"
 * decision, and separating them would make links feel like metadata rather
 * than evidence the AI actually reads.
 *
 * The card is explicit about the privacy boundary for the same reason the
 * files card is: a saved link is private to the account and only reaches an
 * organization when the candidate applies, as a frozen copy.
 *
 * Statuses matter here in a way they do not for files: a link involves
 * fetching someone else's website, which is slow and can fail for reasons the
 * candidate can act on. So every link shows its state, a failed one explains
 * itself in the reader's language, and Retry appears only when retrying could
 * actually help.
 */
export function ProfessionalLinksCard({
  collection,
}: {
  collection: CandidateLinkCollection;
}) {
  const { d, f, date } = useI18n();
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The link a confirmation is currently open for. Deleting evidence also
  // withdraws it from applications already submitted, so it is never a
  // single-click action.
  const [confirming, setConfirming] = useState<CandidateLink | null>(null);
  const [pending, startTransition] = useTransition();

  const { links, limit, remaining } = collection;
  const atLimit = remaining <= 0;

  function reset() {
    setUrl("");
    setTitle("");
    setAdding(false);
    setEditingId(null);
  }

  function submit(event?: React.FormEvent) {
    // The add/edit fields are their own form, so Enter in the URL box adds the
    // link. They used to sit inside the profile form, where Enter submitted
    // the PROFILE and silently discarded the typed address.
    event?.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || pending) return;
    setError(null);

    startTransition(async () => {
      const input = { url: trimmed, title: title.trim() || undefined };
      const result = editingId
        ? await updateCandidateLinkAction(editingId, input)
        : await addCandidateLinkAction(input);

      if (!result.ok) {
        setError(
          localizedLinkError(
            result.code,
            d,
            result.message ?? d.candidateLinks.addFailed,
            (result as { failureCode?: string | null }).failureCode,
          ),
        );
        return;
      }
      reset();
      router.refresh();
    });
  }

  function edit(link: CandidateLink) {
    setError(null);
    setEditingId(link.id);
    setAdding(true);
    setUrl(link.url);
    setTitle(link.title);
  }

  function remove(id: string) {
    if (busyId || pending) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await deleteCandidateLinkAction(id);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message ?? d.candidateLinks.removeFailed);
        return;
      }
      setConfirming(null);
      // The server component re-reads the list from the backend, which stays
      // the source of truth: nothing here keeps a local copy that could drift
      // from what was actually saved.
      router.refresh();
    });
  }

  function retry(id: string) {
    if (busyId || pending) return;
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await reprocessCandidateLinkAction(id);
      setBusyId(null);
      if (!result.ok) {
        setError(
          localizedLinkError(
            result.code,
            d,
            result.message ?? d.candidateLinks.retryFailed,
          ),
        );
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title={d.candidateLinks.title}
        description={f(d.candidateLinks.hint, { limit })}
      />
      <CardBody className="flex flex-col gap-3">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            <AlertIcon className="mt-px size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {links.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li
                key={link.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted/40 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <GlobeIcon className="size-4 shrink-0 text-ink-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {link.title}
                    </span>
                    {/*
                      Never the raw URL at full length: a long address breaks
                      the layout on every viewport. The full one stays on the
                      outbound anchor, which opens with safe rel attributes.
                    */}
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      title={link.url}
                      className="block truncate text-[12px] text-ink-subtle hover:text-brand hover:underline"
                    >
                      {displayUrl(link.url)}
                    </a>
                  </span>
                  <LinkStatusBadge status={link.status} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending || busyId !== null}
                    onClick={() => edit(link)}
                  >
                    {d.common.edit}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={busyId === link.id}
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      setConfirming(link);
                    }}
                  >
                    {d.candidateLinks.remove}
                  </Button>
                </div>

                {link.status === "FAILED" ? (
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <p className="flex-1 text-[12.5px] leading-relaxed text-critical">
                      {localizedLinkFailure(link.failureCode, d)}
                    </p>
                    {/*
                      Retry only where it can help. A blocked private address
                      or a page with no readable content fails the same way
                      every time, and the backend refuses those anyway.
                    */}
                    {linkFailureIsRetryable(link.failureCode) ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        loading={busyId === link.id}
                        disabled={pending}
                        icon={<RefreshIcon className="size-4" />}
                        onClick={() => retry(link.id)}
                      >
                        {d.candidateLinks.retry}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {link.status === "COMPLETED" ? (
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <p className="flex-1 text-[12px] text-ink-subtle">
                      {link.lastFetchedAt
                        ? f(d.candidateLinks.analysedOn, {
                            date: date(link.lastFetchedAt),
                          })
                        : ""}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      loading={busyId === link.id}
                      disabled={pending}
                      icon={<RefreshIcon className="size-4" />}
                      onClick={() => retry(link.id)}
                    >
                      {d.candidateLinks.refresh}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-muted">{d.candidateLinks.empty}</p>
        )}

        {adding ? (
          <form
            onSubmit={submit}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-3 py-3"
          >
            <Input
              label={d.candidateLinks.urlLabel}
              placeholder={d.candidateLinks.urlPlaceholder}
              value={url}
              disabled={pending}
              inputMode="url"
              autoComplete="url"
              onChange={(event) => setUrl(event.target.value)}
            />
            <Input
              label={d.candidateLinks.labelLabel}
              placeholder={d.candidateLinks.labelPlaceholder}
              value={title}
              disabled={pending}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={pending}
                disabled={!url.trim()}
              >
                {editingId ? d.common.save : d.candidateLinks.add}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={reset}
              >
                {d.common.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={links.length > 0 ? "secondary" : "primary"}
              size="sm"
              // Hidden capacity is confusing, so the control stays visible and
              // disabled with the count next to it. The backend enforces the
              // limit regardless of what this button does.
              disabled={atLimit || pending}
              icon={<PlusIcon className="size-4" />}
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
            >
              {d.candidateLinks.add}
            </Button>
            <span className="text-[12.5px] text-ink-muted">
              {f(d.candidateLinks.slots, { count: links.length, limit })}
            </span>
          </div>
        )}

        <p className="text-[12px] leading-relaxed text-ink-subtle">
          {atLimit ? d.candidateLinks.limitReached : d.candidateLinks.privacyNote}
        </p>

        <ConfirmDialog
          open={confirming !== null}
          title={d.candidateLinks.confirmDeleteTitle}
          question={f(d.candidateLinks.confirmDeleteQuestion, {
            name: confirming?.title ?? "",
          })}
          // Stated plainly, because it is the part people do not expect: this
          // is not only removing a row from a profile page.
          consequence={d.candidateLinks.confirmDeleteConsequence}
          confirmLabel={d.candidateLinks.remove}
          error={error}
          pending={pending}
          onConfirm={() => confirming && remove(confirming.id)}
          onCancel={() => setConfirming(null)}
        />
      </CardBody>
    </Card>
  );
}
