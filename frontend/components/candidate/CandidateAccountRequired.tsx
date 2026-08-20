"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { UserIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * Shown on candidate pages before the job-seeker profile exists.
 *
 * Not an error: a recruiter who has never job-hunted, and a freshly registered
 * seeker, both land here legitimately. The one thing that unblocks every
 * candidate feature is creating the profile, so that is the only action.
 */
export function CandidateAccountRequired() {
  const { d } = useI18n();

  return (
    <Card>
      <EmptyState
        icon={<UserIcon className="size-5" />}
        title={d.candidateProfile.notCreated}
        description={d.candidateProfile.createHint}
        action={
          <Link href="/my-profile" className={buttonStyles("primary", "sm")}>
            {d.candidateProfile.create}
          </Link>
        }
      />
    </Card>
  );
}
