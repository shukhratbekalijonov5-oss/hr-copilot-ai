import type { Metadata } from "next";
import { api } from "@/lib/api";
import { requireOrganizationWorkspace } from "@/lib/workspace/server";
import { getTranslations } from "@/lib/i18n/server";
import { PageHeader } from "@/components/layout/PageHeader";
import { InterviewChatWorkspace } from "@/components/chat/InterviewChatWorkspace";
import { MyVacancySelector } from "@/components/vacancies/MyVacancySelector";
import { selectedVacancyId } from "@/lib/vacancy/selection";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.chat.title };
}

/**
 * HR interview chats — creator-scoped.
 *
 * `GET /conversations` now returns only conversations of vacancies the caller
 * CREATED, with or without the filter, so this list is already the honest set:
 * a colleague's conversation is not merely hidden here, it is unreachable
 * (their ids answer 404, indistinguishable from a non-existent one).
 *
 * A `?conversation=` id that is not in that set is therefore resolved to
 * "unavailable" HERE rather than being opened optimistically and retried until
 * the backend 404s. Nothing stale is shown and nothing is polled.
 */
export default async function OrganizationInterviewChatsPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireOrganizationWorkspace();
  const [d, searchParams, myVacancies] = await Promise.all([
    getTranslations(),
    props.searchParams,
    api.getAllMyVacancies().catch(() => []),
  ]);

  const requested = selectedVacancyId(searchParams);
  const vacancyId = myVacancies.some((v) => v.id === requested)
    ? requested!
    : undefined;

  // Passing vacancyId also validates ownership backend-side, so an unusable
  // selection surfaces as an error rather than as a silently empty list.
  const page = await api
    .getOrganizationConversations({ vacancyId, page: 1, limit: 100 })
    .catch(() => null);
  const conversations = page?.conversations ?? [];

  const requestedConversation =
    typeof searchParams.conversation === "string"
      ? searchParams.conversation
      : null;
  const reachable = conversations.some(
    (conversation) => conversation.id === requestedConversation,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title={d.chat.title} description={d.chat.hrDescription} />
      {myVacancies.length > 0 ? (
        <div className="mb-4">
          <MyVacancySelector
            vacancies={myVacancies}
            value={vacancyId ?? null}
            allowEmpty
          />
        </div>
      ) : null}
      <InterviewChatWorkspace
        // Changing the vacancy filter remounts the panel, so no conversation
        // or message from the previous selection stays on screen.
        key={vacancyId ?? "all"}
        side="organization"
        viewerParty="ORGANIZATION"
        conversations={conversations}
        selectedConversationId={reachable ? requestedConversation : null}
        unavailableConversation={Boolean(requestedConversation) && !reachable}
      />
    </div>
  );
}
