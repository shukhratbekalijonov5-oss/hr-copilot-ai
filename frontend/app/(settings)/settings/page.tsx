import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { requireSession } from "@/lib/auth/session";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.settings.title };
}

/**
 * Settings for both product sides — one authenticated account screen.
 *
 * Nothing is fetched here beyond the session: the only section is the profile,
 * and the account it edits is already on the session. Notification delivery is
 * decided server-side and is not a setting, so there is no preference read.
 */
export default async function SettingsPage() {
  const [user, d] = await Promise.all([requireSession(), getTranslations()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={d.settings.title}
        description={d.settings.description}
      />
      <SettingsWorkspace user={user} />
    </div>
  );
}
