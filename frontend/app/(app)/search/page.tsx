import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchWorkspace } from "@/components/search/SearchWorkspace";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.nav.aiSearch };
}

export default async function SearchPage() {
  await requireSession();
  const d = await getTranslations();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={d.search.title}
        description={d.search.description}
      />
      <SearchWorkspace />
    </div>
  );
}
