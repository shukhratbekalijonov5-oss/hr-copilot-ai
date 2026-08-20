"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeVacancyAction } from "@/app/(app)/interview-chats/actions";
import { Button } from "@/components/ui/Button";
import { AlertIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

interface VacancyCloseButtonProps {
  vacancyId: string;
  chatCount: number;
}

export function VacancyCloseButton({
  vacancyId,
  chatCount,
}: VacancyCloseButtonProps) {
  const { d } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setFailure(null);
    startTransition(async () => {
      const result = await closeVacancyAction(vacancyId);
      if (!result.ok) {
        setFailure(result.message ?? d.chat.closeVacancyFailed);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {d.chat.closeVacancy}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-vacancy-title"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-pop"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
                <AlertIcon className="size-4.5" />
              </span>
              <div className="min-w-0">
                <h2
                  id="close-vacancy-title"
                  className="text-base font-semibold tracking-tight text-ink"
                >
                  {d.chat.areYouSure}
                </h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
                  {d.chat.closeVacancyQuestion}
                </p>
                {chatCount > 0 ? (
                  <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-warning">
                    {d.chat.allChatsDeleted}
                  </p>
                ) : null}
                {failure ? (
                  <p role="alert" className="mt-2 text-[13px] text-critical">
                    {failure}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setFailure(null);
                }}
              >
                {d.chat.no}
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={pending}
                onClick={confirm}
              >
                {d.chat.yes}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
