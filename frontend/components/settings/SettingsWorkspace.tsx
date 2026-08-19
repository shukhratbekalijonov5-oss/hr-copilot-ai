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
import {
  INTEGRATION_AVAILABILITY_LABELS,
  INTEGRATION_GROUPS,
} from "@/lib/integrations/catalog";
import type { FieldErrors } from "@/lib/api/errors";
import { ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import type { SettingsData } from "@/lib/types";

function SavedNote({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 text-[12.5px] text-positive"
    >
      <CheckIcon className="size-3.5" />
      Saved
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
          error: result.message ?? "Could not save.",
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
          error: result.message ?? "Could not save.",
          fieldErrors: result.fieldErrors ?? {},
        });
      }
    });
  }

  const tabs: TabItem[] = [
    {
      id: "profile",
      label: "Profile",
      content: (
        <Card>
          <CardHeader
            title="Your profile"
            description="How you appear to the rest of the workspace."
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
                    {ROLE_LABELS[settings.user.role]} ·{" "}
                    {settings.user.organization.name}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Full name"
                  value={fullName}
                  disabled={profilePending}
                  error={profileState.fieldErrors.fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
                <Input
                  label="Email"
                  value={settings.user.email}
                  disabled
                  hint="Changing your sign-in address is not supported by the API yet."
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" loading={profilePending}>
                  Save changes
                </Button>
                <SavedNote visible={profileState.saved && !profilePending} />
              </div>
            </form>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "organization",
      label: "Organization",
      content: (
        <Card>
          <CardHeader
            title="Organization"
            description="Applies to everyone in this workspace."
          />
          <CardBody>
            <form onSubmit={saveOrganization} className="flex flex-col gap-4">
              <FormError message={orgState.error} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Organization name"
                  value={orgName}
                  disabled={orgPending}
                  error={orgState.fieldErrors.name}
                  onChange={(event) => setOrgName(event.target.value)}
                />
                <Input
                  label="Workspace URL"
                  value={settings.organization.slug}
                  disabled
                  hint="Changing the slug would break existing links."
                />
              </div>

              {settings.organization.counts ? (
                <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-muted/50 p-3 sm:grid-cols-4">
                  {(
                    [
                      ["Members", settings.organization.counts.users],
                      ["Vacancies", settings.organization.counts.vacancies],
                      ["Candidates", settings.organization.counts.candidates],
                      ["Documents", settings.organization.counts.documents],
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
                  Save changes
                </Button>
                <SavedNote visible={orgState.saved && !orgPending} />
              </div>
            </form>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "team",
      label: "Team",
      content: (
        <Card>
          <CardHeader
            title="Team"
            description={`${settings.team.length} ${settings.team.length === 1 ? "person has" : "people have"} access to this workspace.`}
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
                  {ROLE_LABELS[member.role]}
                </Badge>
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-line">
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              The API creates teammates with a password set by an admin rather
              than an email invitation, so there is no invite flow here yet.
            </p>
          </CardBody>
        </Card>
      ),
    },
    {
      id: "integrations",
      label: "Integrations",
      content: (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title="Integrations"
              description="Bring applications in from email and job boards so every source lands in one pipeline."
            />
            <CardBody>
              <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
                None of these can be connected yet — the API has no integration
                endpoints or credential storage. They are listed so the intended
                shape is visible; nothing here will report a connection it does
                not have.
              </p>
            </CardBody>
          </Card>

          {INTEGRATION_GROUPS.map((group) => (
            <Card key={group.id}>
              <CardHeader title={group.title} description={group.description} />
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
                        {integration.description}
                      </p>
                    </div>
                    <Badge
                      tone={
                        integration.availability === "requires_partner_approval"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {INTEGRATION_AVAILABILITY_LABELS[integration.availability]}
                    </Badge>
                    <Button type="button" variant="secondary" size="sm" disabled>
                      Connect
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
      label: "Security",
      content: (
        <Card>
          <CardHeader title="Security" />
          <CardBody className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg border border-line p-3">
              <ShieldIcon className="mt-0.5 size-5 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">
                  Session handling
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  Your session is held in a cookie that browser scripts cannot
                  read. Signing out clears it; the underlying token stays valid
                  until it expires, because the API has no revocation endpoint
                  yet.
                </p>
              </div>
            </div>

            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-ink-muted">Role</dt>
                <dd className="text-[13.5px] text-ink">
                  {ROLE_LABELS[settings.user.role]}
                </dd>
              </div>
              {settings.organization.createdAt ? (
                <div>
                  <dt className="text-[12px] text-ink-muted">
                    Workspace created
                  </dt>
                  <dd className="text-[13.5px] text-ink">
                    {formatDate(settings.organization.createdAt)}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled>
                Change password
              </Button>
              <Button type="button" variant="ghost" disabled>
                Enable two-factor authentication
              </Button>
            </div>

            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              These are disabled because the API does not expose them yet. They
              will do nothing until it does.
            </p>
          </CardBody>
        </Card>
      ),
    },
  ];

  return <Tabs items={tabs} />;
}
