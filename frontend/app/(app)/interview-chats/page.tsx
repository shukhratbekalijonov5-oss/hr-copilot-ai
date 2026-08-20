import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { InterviewChatWorkspace } from "@/components/chat/InterviewChatWorkspace";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.chat.title };
}

export default async function OrganizationInterviewChatsPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireOrganizationWorkspace();
  const [d, page, searchParams] = await Promise.all([
    getTranslations(),
    api.getOrganizationConversations({ page: 1, limit: 100 }),
    props.searchParams,
  ]);
  const selected =
    typeof searchParams.conversation === "string"
      ? searchParams.conversation
      : null;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={d.chat.title} description={d.chat.hrDescription} />
      <InterviewChatWorkspace
        side="organization"
        viewerParty="ORGANIZATION"
        conversations={page.conversations}
        selectedConversationId={selected}
      />
    </div>
  );
}
