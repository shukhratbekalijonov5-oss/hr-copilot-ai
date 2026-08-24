import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requirePersonalWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { CandidateAccountRequired } from "@/components/candidate/CandidateAccountRequired";
import { InterviewChatWorkspace } from "@/components/chat/InterviewChatWorkspace";
import { CandidatePageHeader } from "@/components/candidate/ui";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.chat.title };
}

export default async function CandidateInterviewChatsPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const { session } = await requirePersonalWorkspace();
  const [d, searchParams] = await Promise.all([
    getTranslations(),
    props.searchParams,
  ]);

  if (!session.hasCandidateAccount) {
    return (
      <div className="mx-auto max-w-4xl">
        <CandidatePageHeader
          eyebrow={d.nav.sectionProfile}
          title={d.chat.title}
          description={d.chat.candidateDescription}
        />
        <CandidateAccountRequired />
      </div>
    );
  }

  const page = await api.getCandidateConversations({ page: 1, limit: 100 });
  const selected =
    typeof searchParams.conversation === "string"
      ? searchParams.conversation
      : null;

  return (
    <div className="mx-auto max-w-7xl">
      <CandidatePageHeader
          eyebrow={d.nav.sectionProfile}
        title={d.chat.title}
        description={d.chat.candidateDescription}
      />
      <InterviewChatWorkspace
        side="candidate"
        viewerParty="CANDIDATE"
        conversations={page.conversations}
        selectedConversationId={selected}
      />
    </div>
  );
}
