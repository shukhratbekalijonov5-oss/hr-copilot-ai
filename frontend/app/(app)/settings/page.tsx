import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireSession();
  const settings = await api.getSettings();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settings"
        description="Your profile, the organization, and who has access."
      />
      <SettingsWorkspace settings={settings} />
    </div>
  );
}
