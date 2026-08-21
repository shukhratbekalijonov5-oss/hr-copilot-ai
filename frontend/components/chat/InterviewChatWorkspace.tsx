"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  loadOrganizationConversationAction,
  sendOrganizationMessageAction,
} from "@/app/(app)/interview-chats/actions";
import {
  loadCandidateConversationAction,
  sendCandidateMessageAction,
} from "@/app/(candidate)/my-interview-chats/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/Field";
import {
  AlertIcon,
  ChevronLeftIcon,
  MessageIcon,
  SendIcon,
} from "@/components/ui/icons";
import {
  bumpConversationUpdatedAt,
  isCurrentConversationClosed,
  mergeMessageById,
  removeClosedConversation,
  type ConversationClosedEvent,
} from "@/lib/chat/interview-chat-state";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  InterviewChatParty,
  InterviewConversation,
  InterviewMessage,
} from "@/lib/types";

type Side = "organization" | "candidate";
type ConnectionState = "connecting" | "connected" | "disconnected";

interface InterviewChatWorkspaceProps<T extends InterviewConversation> {
  side: Side;
  viewerParty: InterviewChatParty;
  conversations: T[];
  selectedConversationId?: string | null;
  /**
   * The URL named a conversation that is not in the caller's creator-scoped
   * list. Shown as "unavailable" instead of opening something else — and
   * never retried, since the backend answers 404 by design.
   */
  unavailableConversation?: boolean;
}

function conversationTitle(conversation: InterviewConversation): string {
  return conversation.side === "organization"
    ? conversation.candidate.fullName
    : conversation.vacancy.title;
}

function conversationSubtitle(conversation: InterviewConversation): string {
  return conversation.side === "organization"
    ? conversation.vacancy.title
    : conversation.vacancy.organizationName;
}

function conversationHref(conversation: InterviewConversation): string {
  return conversation.side === "organization"
    ? `/vacancies/${conversation.vacancy.id}`
    : `/jobs/${conversation.vacancy.publicSlug}`;
}

function selectedUrl(pathname: string, id: string | null): string {
  if (!id) return pathname;
  const params = new URLSearchParams();
  params.set("conversation", id);
  return `${pathname}?${params.toString()}`;
}

export function InterviewChatWorkspace<T extends InterviewConversation>({
  side,
  viewerParty,
  conversations: initialConversations,
  selectedConversationId,
  unavailableConversation = false,
}: InterviewChatWorkspaceProps<T>) {
  const { d, dateTime } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [conversations, setConversations] = useState<T[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(
    // An unreachable id selects nothing at all: opening the first conversation
    // instead would silently show a different candidate's thread.
    unavailableConversation
      ? null
      : (selectedConversationId ??
        initialConversations.find(
          (conversation) => conversation.id === searchParams.get("conversation"),
        )?.id ??
        initialConversations[0]?.id ??
        null),
  );
  const [messagesById, setMessagesById] = useState<
    Record<string, InterviewMessage[]>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? null;
  const activeMessages = activeId ? (messagesById[activeId] ?? []) : [];
  const loadingMessages = Boolean(
    activeId && !messagesById[activeId] && !loadError,
  );
  const displayedConnection =
    conversations.length === 0 ? "disconnected" : connection;
  const streamKey = useMemo(
    () =>
      conversations
        .map((conversation) => conversation.id)
        .sort()
        .join("&"),
    [conversations],
  );

  useEffect(() => {
    if (!activeId) return;
    if (messagesById[activeId]) return;

    let cancelled = false;

    const load =
      side === "organization"
        ? loadOrganizationConversationAction(activeId)
        : loadCandidateConversationAction(activeId);

    load.then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.reason === "not_found") {
          setNotice(d.chat.chatDeleted);
          setConversations((current) =>
            current.filter((conversation) => conversation.id !== activeId),
          );
          setActiveId(null);
          router.replace(pathname, { scroll: false });
          return;
        }
        setLoadError(result.message ?? d.chat.loadFailed);
        return;
      }

      setMessagesById((current) => ({
        ...current,
        [activeId]: result.data.messages,
      }));
      setConversations((current) => {
        if (current.some((conversation) => conversation.id === result.data.conversation.id)) {
          return current.map((conversation) =>
            conversation.id === result.data.conversation.id
              ? (result.data.conversation as T)
              : conversation,
          );
        }
        return [result.data.conversation as T, ...current];
      });
    });

    return () => {
      cancelled = true;
    };
  }, [activeId, d.chat.chatDeleted, d.chat.loadFailed, messagesById, pathname, router, side]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [activeId, activeMessages.length]);

  useEffect(() => {
    const streamIds = streamKey ? streamKey.split("&") : [];
    if (streamIds.length === 0) {
      return;
    }
    const params = new URLSearchParams();
    for (const id of streamIds) params.append("conversationId", id);
    const source = new EventSource(`/api/chat/stream?${params.toString()}`);

    source.addEventListener("ready", () => setConnection("connected"));
    source.addEventListener("disconnected", () => setConnection("disconnected"));
    source.addEventListener("message", (event) => {
      const message = JSON.parse((event as MessageEvent).data) as InterviewMessage;
      setMessagesById((current) => ({
        ...current,
        [message.conversationId]: mergeMessageById(
          current[message.conversationId] ?? [],
          message,
        ),
      }));
      setConversations((current) => bumpConversationUpdatedAt(current, message));
    });
    source.addEventListener("closed", (event) => {
      const closed = JSON.parse((event as MessageEvent).data) as ConversationClosedEvent;
      setConversations((current) => removeClosedConversation(current, closed));
      setMessagesById((current) => {
        const next = { ...current };
        delete next[closed.conversationId];
        return next;
      });
      setNotice(
        closed.reason === "CANDIDATE_REJECTED"
          ? d.chat.candidateRejectedNotice
          : d.chat.vacancyClosedNotice,
      );
      setActiveId((current) => {
        if (!isCurrentConversationClosed(current, closed)) return current;
        router.replace(pathname, { scroll: false });
        return null;
      });
    });

    source.onerror = () => setConnection("disconnected");

    return () => source.close();
  }, [
    d.chat.candidateRejectedNotice,
    d.chat.vacancyClosedNotice,
    pathname,
    router,
    streamKey,
  ]);

  function selectConversation(id: string | null) {
    setActiveId(id);
    setLoadError(null);
    setSendError(null);
    router.replace(selectedUrl(pathname, id), { scroll: false });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeId || sending) return;

    const content = draft.trim();
    if (!content) return;

    setSending(true);
    setSendError(null);

    startTransition(async () => {
      const result =
        side === "organization"
          ? await sendOrganizationMessageAction(activeId, content)
          : await sendCandidateMessageAction(activeId, content);

      setSending(false);
      if (!result.ok) {
        if (result.reason === "not_found") {
          setNotice(d.chat.chatDeleted);
          setConversations((current) =>
            current.filter((conversation) => conversation.id !== activeId),
          );
          setMessagesById((current) => {
            const next = { ...current };
            delete next[activeId];
            return next;
          });
          setActiveId(null);
          router.replace(pathname, { scroll: false });
          return;
        }
        setSendError(result.message ?? d.chat.sendFailed);
        return;
      }

      setDraft("");
      setMessagesById((current) => ({
        ...current,
        [activeId]: mergeMessageById(current[activeId] ?? [], result.data),
      }));
      setConversations((current) => bumpConversationUpdatedAt(current, result.data));
    });
  }

  const list = (
    <Card className="min-h-[26rem] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-ink">
            {d.chat.conversations}
          </h2>
          <p className="text-[12.5px] text-ink-muted">
            {d.chat.conversationsHint}
          </p>
        </div>
        <Badge tone={displayedConnection === "connected" ? "positive" : "neutral"}>
          {displayedConnection === "connected"
            ? d.chat.connected
            : displayedConnection === "connecting"
              ? d.chat.connecting
              : d.chat.reconnecting}
        </Badge>
      </div>
      {conversations.length === 0 ? (
        <EmptyState
          icon={<MessageIcon className="size-5" />}
          title={d.chat.noConversations}
          description={d.chat.noConversationsHint}
        />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => selectConversation(conversation.id)}
                aria-current={activeId === conversation.id ? "true" : undefined}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors",
                  activeId === conversation.id
                    ? "bg-brand-soft"
                    : "hover:bg-surface-muted/70",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-brand">
                  <MessageIcon className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {conversationTitle(conversation)}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-muted">
                    {conversationSubtitle(conversation)}
                  </span>
                </span>
                <span className="hidden whitespace-nowrap text-[11.5px] text-ink-subtle sm:inline">
                  {dateTime(conversation.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  const panel = (
    <Card className="flex min-h-[calc(100dvh-10rem)] flex-col overflow-hidden">
      {activeConversation ? (
        <>
          <div className="flex items-start gap-3 border-b border-line px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => selectConversation(null)}
            >
              <ChevronLeftIcon className="size-4" />
              {d.common.back}
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold tracking-tight text-ink">
                {conversationTitle(activeConversation)}
              </h2>
              <p className="truncate text-[12.5px] text-ink-muted">
                {conversationSubtitle(activeConversation)}
              </p>
            </div>
            <Link
              href={conversationHref(activeConversation)}
              className="text-[12.5px] font-medium text-brand hover:underline"
            >
              {activeConversation.side === "organization"
                ? d.chat.viewVacancy
                : d.chat.viewJob}
            </Link>
          </div>

          {loadError ? (
            <p
              role="alert"
              className="mx-4 mt-4 flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical"
            >
              <AlertIcon className="mt-px size-4 shrink-0" />
              {loadError}
            </p>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-surface-muted/30 px-4 py-4">
            {loadingMessages ? (
              <p role="status" className="text-[13px] text-ink-muted">
                {d.chat.loadingMessages}
              </p>
            ) : activeMessages.length === 0 ? (
              <div className="my-auto">
                <EmptyState
                  icon={<MessageIcon className="size-5" />}
                  title={d.chat.emptyConversation}
                  description={d.chat.emptyConversationHint}
                />
              </div>
            ) : (
              activeMessages.map((message) => {
                const mine = message.senderParty === viewerParty;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      mine ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[min(36rem,82%)] rounded-xl px-3 py-2 shadow-sm",
                        mine
                          ? "bg-brand text-white"
                          : "border border-line bg-surface text-ink",
                      )}
                    >
                      <p
                        className={cn(
                          "mb-1 text-[11.5px] font-medium",
                          mine ? "text-white/75" : "text-ink-subtle",
                        )}
                      >
                        {mine ? d.chat.you : message.senderName}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                        {message.content}
                      </p>
                      <p
                        className={cn(
                          "mt-1 text-[11px]",
                          mine ? "text-white/70" : "text-ink-subtle",
                        )}
                      >
                        {dateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messageEndRef} />
          </div>

          <form
            onSubmit={submit}
            className="border-t border-line bg-surface p-3"
          >
            {sendError ? (
              <p role="alert" className="mb-2 text-[12.5px] text-critical">
                {sendError}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={d.chat.typeMessage}
                  aria-label={d.chat.typeMessage}
                  rows={2}
                  maxLength={4000}
                  className="min-h-11 resize-none"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </div>
              <Button
                type="submit"
                loading={sending || isPending}
                disabled={!draft.trim() || sending}
              >
                <SendIcon className="size-4" />
                {d.chat.send}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<MessageIcon className="size-5" />}
            title={
              unavailableConversation
                ? d.vacancyScope.chatUnavailable
                : d.chat.selectConversation
            }
            description={
              unavailableConversation
                ? d.vacancyScope.chatUnavailableHint
                : d.chat.selectConversationHint
            }
          />
        </div>
      )}
    </Card>
  );

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink-muted"
        >
          <AlertIcon className="mt-px size-4 shrink-0 text-brand" />
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <div className={cn(activeConversation ? "hidden lg:block" : "block")}>
          {list}
        </div>
        <div className={cn(activeConversation ? "block" : "hidden lg:block")}>
          {panel}
        </div>
      </div>
    </div>
  );
}
