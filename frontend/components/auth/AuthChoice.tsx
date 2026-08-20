"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { BriefcaseIcon, BuildingIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

export function AuthChoice({ mode }: { mode: "login" | "register" }) {
  const { d } = useI18n();
  const candidateHref =
    mode === "login" ? "/login/candidate" : "/register/candidate";
  const organizationHref =
    mode === "login" ? "/login/organization" : "/register/organization";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {mode === "login" ? d.auth.chooseSignIn : d.auth.chooseRegistration}
        </h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
          {d.auth.chooseAccountTypeHint}
        </p>
      </div>

      <div className="grid gap-3">
        <ChoiceCard
          href={candidateHref}
          icon={<BriefcaseIcon className="size-5" />}
          title={
            mode === "login"
              ? d.auth.candidateSignIn
              : d.auth.createCandidateAccount
          }
          description={d.auth.candidateAuthHint}
        />
        <ChoiceCard
          href={organizationHref}
          icon={<BuildingIcon className="size-5" />}
          title={
            mode === "login"
              ? d.auth.organizationSignIn
              : d.auth.createOrganizationAccount
          }
          description={d.auth.organizationAuthHint}
        />
      </div>

      <p className="text-center text-[12.5px] leading-relaxed text-ink-muted">
        {d.auth.accountTypeExclusive}
      </p>
    </div>
  );
}

function ChoiceCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="p-0">
      <Link
        href={href}
        className="flex items-start gap-3 p-4 transition-colors hover:bg-surface-muted/50"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-muted">
            {description}
          </span>
        </span>
      </Link>
    </Card>
  );
}
