"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/Field";
import { buttonStyles } from "@/components/ui/Button";
import { BriefcaseIcon, PlusIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";
import { withVacancyParam } from "@/lib/vacancy/selection";
import { cn } from "@/lib/utils";
import type { MyVacancy } from "@/lib/types";

interface MyVacancySelectorProps {
  /** Rows from GET /vacancies/mine — never the org-wide catalog. */
  vacancies: MyVacancy[];
  value: string | null;
  /** Controlled mode. Omit for URL-driven mode. */
  onChange?: (vacancyId: string) => void;
  /** Whether "no vacancy" is a legal state on this screen. */
  allowEmpty?: boolean;
  label?: string;
  /** Shown when the URL asked for a vacancy that is not the caller's. */
  invalid?: boolean;
  className?: string;
}

/**
 * The one vacancy picker, used by every creator-scoped surface.
 *
 * Its rows come only from `/vacancies/mine`: the organization-wide catalog
 * lists colleagues' vacancies, and every one of those answers 403
 * VACANCY_NOT_OWNED the moment the user tries to work inside it — offering
 * them would be building a menu of guaranteed failures.
 *
 * Two modes, one appearance. Given `onChange` it is a controlled form field;
 * without one it drives `?vacancyId=` in the URL, which is what makes the
 * selection survive a refresh and re-render every dependent server component.
 *
 * The empty state is a real state, not a disabled dropdown: a user with no
 * vacancies of their own cannot do anything here until they create one, and
 * saying that is more useful than an empty menu.
 */
export function MyVacancySelector({
  vacancies,
  value,
  onChange,
  allowEmpty = false,
  label,
  invalid = false,
  className,
}: MyVacancySelectorProps) {
  const { d, p } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const heading = label ?? d.vacancyScope.selectorLabel;

  if (vacancies.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center",
          className,
        )}
      >
        <BriefcaseIcon className="size-5 shrink-0 text-ink-subtle" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">
            {d.vacancyScope.noneTitle}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">
            {d.vacancyScope.noneHint}
          </p>
        </div>
        <Link
          href="/vacancies/new"
          className={cn(buttonStyles("primary", "sm"), "shrink-0")}
        >
          <PlusIcon className="size-4" />
          {d.vacancies.create}
        </Link>
      </div>
    );
  }

  function select(nextId: string) {
    if (onChange) {
      onChange(nextId);
      return;
    }
    // URL-driven: the server tree re-renders for the new vacancy, so every
    // dependent section refetches and nothing from the old one survives.
    startTransition(() => {
      router.push(withVacancyParam(pathname, params, nextId || null));
    });
  }

  const options = [
    ...(allowEmpty || !value
      ? [
          {
            value: "",
            label: allowEmpty
              ? d.vacancyScope.allVacancies
              : d.vacancyScope.choosePlaceholder,
          },
        ]
      : []),
    ...vacancies.map((vacancy) => ({
      value: vacancy.id,
      label: `${vacancy.title} · ${p(d.common.candidates, vacancy.candidateCount)}`,
    })),
  ];

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 sm:flex-row sm:items-center sm:gap-3",
        invalid && "border-critical",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:shrink-0">
        <BriefcaseIcon className="size-4 shrink-0 text-ink-subtle" />
        <span className="text-[12.5px] font-medium text-ink-muted">
          {heading}
        </span>
      </div>
      <Select
        aria-label={heading}
        value={value ?? ""}
        disabled={pending}
        options={options}
        onChange={(event) => select(event.target.value)}
        className="min-w-0 flex-1"
      />
      {invalid ? (
        <p role="alert" className="text-[12.5px] text-critical sm:shrink-0">
          {d.vacancyScope.invalidSelection}
        </p>
      ) : null}
    </div>
  );
}
