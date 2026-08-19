import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProcessingView } from "@/components/processing/ProcessingView";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.processing.title };
}

export default async function ProcessingPage() {
  await requireSession();
  const d = await getTranslations();

  const [{ jobs }, summary] = await Promise.all([
    api.getProcessingJobs({ limit: 100 }),
    api.getProcessingSummary(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={d.processing.title}
        description={d.processing.description}
      />
      <ProcessingView jobs={jobs} summary={summary} />
    </div>
  );
}
