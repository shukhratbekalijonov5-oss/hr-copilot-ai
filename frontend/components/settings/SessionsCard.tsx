"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutAllAction, revokeSessionAction } from "@/lib/auth/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertIcon, ShieldIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import type { AuthSessionRow } from "@/lib/types";

/**
 * Live sessions, and the controls to end them.
 *
 * Shows only what `GET /auth/sessions` returns — device label, user agent,
 * timestamps, and which row is the caller's own. Token material is neither
 * displayed nor requested; the session id is used solely as the argument to
 * `DELETE /auth/sessions/:id`.
 */
export function SessionsCard({ sessions }: { sessions: AuthSessionRow[] }) {
  const { d, f, dateTime } = useI18n();
  const router = useRouter();

  const [rows, setRows] = useState(sessions);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [signingOutAll, startSignOutAll] = useTransition();

  function revoke(id: string) {
    if (pending) return;
    setError(null);
    setBusyId(id);

    startTransition(async () => {
      const result = await revokeSessionAction(id);
      setBusyId(null);
      if (!result.ok) {
        setError(result.message ?? d.sessions.revokeFailed);
        return;
      }
      setRows((current) => current.filter((row) => row.id !== id));
      router.refresh();
    });
  }

  /** Ends every session including this browser's, so it navigates to login. */
  function signOutEverywhere() {
    if (signingOutAll) return;
    startSignOutAll(async () => {
      await logoutAllAction();
    });
  }

  /** A user agent is long and technical; the first token is enough to place it. */
  const deviceLabel = (row: AuthSessionRow) =>
    row.deviceName?.trim() ||
    row.userAgent?.split(")")[0]?.replace("Mozilla/5.0 (", "").trim() ||
    d.sessions.unknownDevice;

  return (
    <Card>
      <CardHeader
        title={d.sessions.title}
        description={d.sessions.description}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldIcon className="size-5" />}
          title={d.sessions.unavailable}
          description={d.sessions.unavailableHint}
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 truncate text-[13.5px] font-medium text-ink">
                  {deviceLabel(row)}
                  {row.current ? (
                    <Badge tone="brand">{d.sessions.thisDevice}</Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-subtle">
                  <span>
                    {f(d.sessions.lastUsed, { date: dateTime(row.lastUsedAt) })}
                  </span>
                  <span>
                    {f(d.sessions.created, { date: dateTime(row.createdAt) })}
                  </span>
                  <span>
                    {f(d.sessions.expires, { date: dateTime(row.expiresAt) })}
                  </span>
                </p>
              </div>

              {row.current ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={busyId === row.id}
                  disabled={pending}
                  title={f(d.sessions.signOutTitle, { device: deviceLabel(row) })}
                  onClick={() => revoke(row.id)}
                >
                  {d.sessions.signOut}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <CardBody className="flex flex-col gap-3 border-t border-line">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
          >
            <AlertIcon className="mt-px size-4 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="danger"
            size="sm"
            loading={signingOutAll}
            disabled={signingOutAll}
            onClick={signOutEverywhere}
          >
            {signingOutAll
              ? d.sessions.signingOut
              : d.sessions.signOutEverywhere}
          </Button>
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            {d.sessions.signOutEverywhereHint}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
