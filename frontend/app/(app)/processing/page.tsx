import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProcessingView } from "@/components/processing/ProcessingView";

export const metadata: Metadata = { title: "Processing" };

export default async function ProcessingPage() {
  await requireSession();

  const [{ jobs }, summary] = await Promise.all([
    api.getProcessingJobs({ limit: 100 }),
    api.getProcessingSummary(),
  ]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Processing"
        description="Every uploaded document and where it sits in the parse → index pipeline."
      />
      <ProcessingView jobs={jobs} summary={summary} />
    </div>
  );
}
