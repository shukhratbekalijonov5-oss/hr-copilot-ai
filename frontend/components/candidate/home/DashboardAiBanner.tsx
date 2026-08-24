"use client";

import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * The closing invitation.
 *
 * One accent panel at the foot of the dashboard, with the AI halo and a
 * single action. It is the only banner in the candidate product — the value
 * of a glowing call to action collapses the moment there are two of them on
 * one screen.
 *
 * Deliberately not plan-aware: it points at the profile, which everyone can
 * improve on every plan, so it never becomes an upsell wearing a helpful hat.
 */
export function DashboardAiBanner() {
  const { d } = useI18n();

  return (
    <section className="accent-panel ai-halo relative overflow-hidden rounded-[16px] border border-ai-line p-5 sm:p-6">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-10 hidden text-brand/10 sm:block"
      >
        <SparkIcon className="size-44" />
      </span>

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {d.home.banner.title}
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            {d.home.banner.description}
          </p>
        </div>
        <Link
          href="/my-profile"
          className={buttonStyles("primary", "md", "shrink-0")}
        >
          <SparkIcon className="size-4" />
          {d.home.banner.action}
        </Link>
      </div>
    </section>
  );
}
