"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateOrganizationAction,
  updateProfileAction,
} from "@/app/(app)/settings/actions";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { AlertIcon, CheckIcon, ShieldIcon } from "@/components/ui/icons";
import { INTEGRATION_GROUPS } from "@/lib/integrations/catalog";
import { LocaleSwitcher } from "@/components/layout/LocaleSwitcher";
import { useI18n } from "@/lib/i18n/context";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { FieldErrors } from "@/lib/api/errors";
import type { SettingsData } from "@/lib/types";

function SavedNote({ visible, label }: { visible: boolean; label: string }) {
  if (!visible) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 text-[12.5px] text-positive"
    >
      <CheckIcon className="size-3.5" />
      {label}
    </span>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
    >
      <AlertIcon className="size-4 shrink-0" />
      {message}
    </p>
  );
}

/**
 * Only what the API actually supports is editable. Controls for features the
 * backend has not shipped stay visibly disabled rather than pretending to work
 * — a fake success message here would be a lie about a security setting.
 */
export function SettingsWorkspace({ settings }: { settings: SettingsData }) {
  const router = useRouter();
  const { d, p, date } = useI18n();

  // Group and integration copy is keyed by the catalogue's own ids, so adding
  // an integration surfaces a missing translation as a typecheck failure.
  const groupTitle = (id: string) =>
    id === "email" ? d.integrations.groupEmail : d.integrations.groupJobBoards;
  const groupHint = (id: string) =>
    id === "email"
      ? d.integrations.groupEmailHint
      : d.integrations.groupJobBoardsHint;
  const integrationHint = (id: string) =>
    d.integrations[id as keyof Dictionary["integrations"]];

  const [fullName, setFullName] = useState(settings.user.fullName);
  const [profileState, setProfileState] = useState<{
    saved: boolean;
    error: string | null;
    fieldErrors: FieldErrors;
  }>({ saved: false, error: null, fieldErrors: {} });
  const [profilePending, startProfile] = useTransition();

  const [orgName, setOrgName] = useState(settings.organization.name);
  const [orgState, setOrgState] = useState<{
    saved: boolean;
    error: string | null;
    fieldErrors: FieldErrors;
  }>({ saved: false, error: null, fieldErrors: {} });
  const [orgPending, startOrg] = useTransition();

  function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    if (profilePending) return;
    setProfileState({ saved: false, error: null, fieldErrors: {} });

    startProfile(async () => {
      const result = await updateProfileAction(settings.user.id, {
        fullName: fullName.trim(),
      });
      if (result.ok) {
        setProfileState({ saved: true, error: null, fieldErrors: {} });
        router.refresh();
      } else {
        setProfileState({
          saved: false,
          error: result.message ?? d.settings.couldNotSave,
          fieldErrors: result.fieldErrors ?? {},
        });
      }
    });
  }

  function saveOrganization(event: React.FormEvent) {
    event.preventDefault();
    if (orgPending) return;
    setOrgState({ saved: false, error: null, fieldErrors: {} });

    startOrg(async () => {
      const result = await updateOrganizationAction({ name: orgName.trim() });
      if (result.ok) {
        setOrgState({ saved: true, error: null, fieldErrors: {} });
        router.refresh();
      } else {
        setOrgState({
          saved: false,
          error: result.message ?? d.settings.couldNotSave,
          fieldErrors: result.fieldErrors ?? {},
        });
      }
    });
  }

  const tabs: TabItem[] = [
    {
      id: "profile",
      label: d.settings.tabProfile,
      content: (
        <Card>
          <CardHeader
            title={d.settings.yourProfile}
            description={d.settings.yourProfileHint}
          />
          <CardBody>
            <form onSubmit={saveProfile} className="flex flex-col gap-4">
              <FormError message={profileState.error} />

              <div className="flex items-center gap-3">
                <Avatar name={fullName || settings.user.email} size="lg" />
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    {settings.user.fullName}
                  </p>
                  <p className="text-[12.5px] text-ink-muted">
                    {d.status.role[settings.user.role]} ·{" "}
                    {settings.user.organization.name}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={d.settings.fullName}
                  value={fullName}
                  disabled={profilePending}
                  error={profileState.fieldErrors.fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
                <Input
                  label={d.settings.email}
                  value={settings.user.email}
                  disabled
                  hint={d.settings.emailLocked}
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" loading={profilePending}>
                  {d.common.save}
                </Button>
                <SavedNote
                  visible={profileState.saved && !profilePending}
                  label={d.common.saved}
                />
              </div>
            </form>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "organization",
      label: d.settings.tabOrganization,
      content: (
        <Card>
          <CardHeader
            title={d.settings.organization}
            description={d.settings.organizationHint}
          />
          <CardBody>
            <form onSubmit={saveOrganization} className="flex flex-col gap-4">
              <FormError message={orgState.error} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={d.settings.organizationName}
                  value={orgName}
                  disabled={orgPending}
                  error={orgState.fieldErrors.name}
                  onChange={(event) => setOrgName(event.target.value)}
                />
                <Input
                  label={d.settings.workspaceUrl}
                  value={settings.organization.slug}
                  disabled
                  hint={d.settings.slugLocked}
                />
              </div>

              {settings.organization.counts ? (
                <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-muted/50 p-3 sm:grid-cols-4">
                  {(
                    [
                      [d.settings.countMembers, settings.organization.counts.users],
                      [
                        d.settings.countVacancies,
                        settings.organization.counts.vacancies,
                      ],
                      [
                        d.settings.countCandidates,
                        settings.organization.counts.candidates,
                      ],
                      [
                        d.settings.countDocuments,
                        settings.organization.counts.documents,
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[12px] text-ink-muted">{label}</dt>
                      <dd className="text-[15px] font-semibold tabular-nums text-ink">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="flex items-center gap-3">
                <Button type="submit" loading={orgPending}>
                  {d.common.save}
                </Button>
                <SavedNote
                  visible={orgState.saved && !orgPending}
                  label={d.common.saved}
                />
              </div>
            </form>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "team",
      label: d.settings.tabTeam,
      content: (
        <Card>
          <CardHeader
            title={d.settings.team}
            description={p(d.settings.teamAccess, settings.team.length)}
          />
          <ul className="divide-y divide-[var(--line)]">
            {settings.team.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={member.fullName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-ink">
                    {member.fullName}
                  </p>
                  <p className="truncate text-[12.5px] text-ink-muted">
                    {member.email}
                  </p>
                </div>
                <Badge tone={member.id === settings.user.id ? "brand" : "neutral"}>
                  {d.status.role[member.role]}
                </Badge>
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-line">
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {d.settings.inviteNote}
            </p>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "integrations",
      label: d.settings.tabIntegrations,
      content: (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={d.settings.integrations}
              description={d.settings.integrationsHint}
            />
            <CardBody>
              <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
                {d.settings.integrationsUnavailable}
              </p>
            </CardBody>
          </Card>

          {INTEGRATION_GROUPS.map((group) => (
            <Card key={group.id}>
              <CardHeader
                title={groupTitle(group.id)}
                description={groupHint(group.id)}
              />
              <ul className="divide-y divide-[var(--line)]">
                {group.integrations.map((integration) => (
                  <li
                    key={integration.id}
                    className="flex flex-wrap items-start gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink">
                        {integration.name}
                      </p>
                      <p className="text-[12.5px] leading-relaxed text-ink-muted">
                        {integrationHint(integration.id)}
                      </p>
                    </div>
                    <Badge
                      tone={
                        integration.availability === "requires_partner_approval"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {d.status.integrationAvailability[integration.availability]}
                    </Badge>
                    <Button type="button" variant="secondary" size="sm" disabled>
                      {d.settings.connect}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ),
    },
    {
      id: "security",
      label: d.settings.tabSecurity,
      content: (
        <Card>
          <CardHeader title={d.settings.security} />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg border border-line p-3">
              <ShieldIcon className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">
                  {d.settings.sessionHandling}
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  {d.settings.sessionHandlingHint}
                </p>
              </div>
            </div>

            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-ink-muted">{d.settings.role}</dt>
                <dd className="text-[13.5px] text-ink">
                  {d.status.role[settings.user.role]}
                </dd>
              </div>
              {settings.organization.createdAt ? (
                <div>
                  <dt className="text-[12px] text-ink-muted">
                    {d.settings.workspaceCreated}
                  </dt>
                  <dd className="text-[13.5px] text-ink">
                    {date(settings.organization.createdAt)}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled>
                {d.settings.changePassword}
              </Button>
              <Button type="button" variant="ghost" disabled>
                {d.settings.enableTwoFactor}
              </Button>
            </div>

            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {d.settings.disabledNote}
            </p>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "language",
      label: d.settings.tabLanguage,
      content: (
        <Card>
          <CardHeader
            title={d.settings.languageTitle}
            description={d.settings.languageHint}
          />
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <LocaleSwitcher />
            </div>
            {/* The backend has no preferredLocale on a user, so this is stated
                rather than quietly presented as an account setting. */}
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              {d.settings.languageStoredLocally}
            </p>
          </CardBody>
        </Card>
      ),
    },
  ];

  return <Tabs items={tabs} label={d.settings.title} />;
}
