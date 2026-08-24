"use client";

import { AccountProfileCard } from "@/components/account/AccountProfileCard";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { useI18n } from "@/lib/i18n/context";
import type { SessionUser } from "@/lib/types";

/**
 * Settings is exactly one section: the account profile.
 *
 * ## No tab strip for a single section
 *
 * A tablist with one tab is chrome that carries no choice — and an
 * `aria-selected` control a reader can never change is worse than no control
 * at all. When Settings gains a second section the strip comes back with it;
 * until then the section renders directly.
 *
 * ## Email is not configurable here, by product decision
 *
 * Which notifications become email is fixed server-side (account created,
 * subscription activated, subscription expiring). Everything else is in-app
 * only. There is deliberately no toggle for any of it: a switch that cannot
 * change delivery would be a lie about a setting, so the screen states the
 * rule instead of pretending to own it.
 */
export function SettingsWorkspace({ user }: { user: SessionUser }) {
  const { d } = useI18n();

  return (
    <Card>
      <CardHeader
        title={d.settings.yourProfile}
        description={d.settings.yourProfileHint}
      />
      <CardBody className="flex flex-col gap-4">
        {/*
          The same component the candidate profile uses: name, sign-in address
          and picture are one account, edited through one endpoint.
        */}
        <AccountProfileCard
          user={user}
          subtitle={
            user.activeOrganization
              ? `${d.status.role[user.activeOrganization.role]} · ${user.activeOrganization.name}`
              : d.nav.personal
          }
        />

        {/*
          Non-interactive on purpose. It answers "where do those emails go"
          next to the address they go to, and nowhere claims the reader can
          turn them off.
        */}
        <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          {d.settings.accountEmailNote}
        </p>
      </CardBody>
    </Card>
  );
}
