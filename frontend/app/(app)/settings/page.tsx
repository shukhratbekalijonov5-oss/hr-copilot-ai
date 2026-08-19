import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.settings.title };
}

export default async function SettingsPage() {
  await requireSession();
  const [settings, d] = await Promise.all([
    api.getSettings(),
    getTranslations(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={d.settings.title}
        description={d.settings.description}
      />
      <SettingsWorkspace settings={settings} />
    </div>
  );
}
