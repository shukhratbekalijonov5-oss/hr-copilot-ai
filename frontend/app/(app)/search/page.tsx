import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/PageHeader";
import { SearchWorkspace } from "@/components/search/SearchWorkspace";

export const metadata: Metadata = { title: "AI Search" };

export default async function SearchPage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="AI candidate search"
        description="Ask in plain language. Every result shows the passage it came from, with its document and page."
      />
      <SearchWorkspace />
    </div>
  );
}
