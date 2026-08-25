import { useCallback, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  Button,
  CardSkeleton,
  EmptyState,
  ErrorState,
  Meta,
} from "@/components/ui/index";
import { ListFooter } from "@/components/ui/ListFooter";
import { useI18n } from "@/lib/i18n/index";
import { queryKeys } from "@/lib/query/keys";
import { appendMessage, useMessages, useSendMessage } from "@/features/chat/messages";
import { useChatSocket } from "@/lib/realtime/socket";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

/**
 * One conversation.
 *
 * ## Send over REST, receive over the socket
 *
 * A POST returns a definite success or a definite failure; a socket emit
 * dropped during a reconnect is indistinguishable from one still in flight,
 * which is how a message silently vanishes. So the socket's job here is to
 * deliver the OTHER party's messages, and ours go over HTTP.
 *
 * ## Every arrival is de-duplicated by the server's id
 *
 * The same message reaches this screen twice on a good day — once as the
 * POST reply, once as the broadcast echo — and a reconnect can replay events
 * we already hold. Keying on the id makes all of that idempotent without
 * sequence numbers or client-generated ids to reconcile.
 *
 * ## Inverted list, because a transcript is read from the end
 *
 * `inverted` puts the newest message at the bottom with no scroll-to-end
 * dance on every render, and it keeps the reader's position when older
 * messages load above.
 */
export function ChatThread({
  audience,
  conversationId,
  title,
}: {
  audience: "candidate" | "recruiter";
  conversationId: string;
  title?: string | null;
}) {
  const { d, locale } = useI18n();
  const client = useQueryClient();
  const messages = useMessages(audience, conversationId);
  const send = useSendMessage(audience, conversationId);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);

  /*
   * A message from the socket goes through the same merge the POST reply
   * uses, so the two paths cannot produce a duplicate row.
   */
  const onMessage = useCallback(
    (incoming: unknown) => {
      const message = incoming as ChatMessage;
      if (!message?.id || message.conversationId !== conversationId) return;
      // Lands on the NEWEST page, de-duplicated by server id.
      appendMessage(client, conversationId, message);
    },
    [client, conversationId],
  );

  /*
   * After a reconnect the transcript is refetched rather than replayed:
   * anything that arrived while the socket was down was never broadcast to
   * us, and the list endpoint is the only thing that knows about it.
   */
  const onResync = useCallback(() => {
    // The bounds probe too: messages may have arrived while we were down, so
    // the last page is not necessarily the last page any more.
    void client.invalidateQueries({ queryKey: ["chat", "messageBounds"] });
    void client.invalidateQueries({
      queryKey: queryKeys.chat.messages(conversationId),
    });
  }, [client, conversationId]);

  const connection = useChatSocket({
    conversationId,
    onMessage,
    onResync,
  });

  function submit() {
    const content = draft.trim();
    if (content.length === 0 || send.isPending) return;
    setDraft("");
    void Haptics.selectionAsync();
    send.mutate(content, {
      onError: () => {
        // Put the text back rather than losing it — the reader typed it.
        setDraft(content);
      },
    });
  }

  if (messages.isLoading) {
    return (
      <View className="px-4 pt-4">
        <CardSkeleton rows={4} />
      </View>
    );
  }

  if (messages.isError) {
    return (
      <View className="px-4 pt-4">
        <ErrorState
          title={d.common.somethingWentWrong}
          retryLabel={d.common.retry}
          onRetry={() => void messages.refetch()}
        />
      </View>
    );
  }

  const rows = messages.messages;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Connection state is stated, not hidden: a reader who thinks a
          message sent when the socket is down deserves to know. */}
      {connection !== "connected" ? (
        <View
          accessibilityRole="alert"
          className="border-b border-line bg-warning-soft px-4 py-2"
        >
          <Text className="text-[12.5px] text-warning">
            {connection === "connecting"
              ? d.realtime.reconnecting
              : d.realtime.offline}
          </Text>
        </View>
      ) : null}

      {title ? (
        <View className="border-b border-line bg-surface px-4 py-2">
          <Meta>{title}</Meta>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <View className="flex-1 px-4 pt-4">
          <EmptyState title={d.chat.empty} description={d.chat.emptyHint} />
        </View>
      ) : (
        <FlatList
          /*
           * `rows` is chronological, oldest first. `inverted` renders it from
           * the end, so the newest message sits at the bottom with no
           * scroll-to-end on every render — which is why the data is reversed
           * for display but never re-sorted.
           */
          data={[...rows].reverse()}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 py-4 gap-2"
          showsVerticalScrollIndicator={false}
          /*
           * In an inverted list "the end" is the TOP, so this fires when the
           * reader scrolls up into history — which is exactly when the next
           * (older) page should load.
           */
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (messages.hasNextPage && !messages.isFetchingNextPage) {
              void messages.fetchNextPage();
            }
          }}
          ListFooterComponent={
            <ListFooter loading={messages.isFetchingNextPage} />
          }
          renderItem={({ item }) => (
            <Bubble message={item} locale={locale} />
          )}
        />
      )}

      <View className="flex-row items-end gap-2 border-t border-line bg-surface px-3 py-2.5">
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          multiline
          placeholder={d.chat.messagePlaceholder}
          accessibilityLabel={d.chat.messagePlaceholder}
          placeholderTextColor="#8393ac"
          className="max-h-[110px] min-h-[44px] flex-1 rounded-control border border-line bg-surface-muted px-3 py-2 text-[14px] text-ink"
        />
        <Button
          title={d.chat.send}
          onPress={submit}
          loading={send.isPending}
          disabled={draft.trim().length === 0}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message, locale }: { message: ChatMessage; locale: string }) {
  const mine = message.isMine === true;

  return (
    <View
      className={cn(
        "max-w-[82%] rounded-card px-3.5 py-2.5",
        mine
          ? "self-end bg-brand"
          : "self-start border border-line bg-surface",
      )}
    >
      {/* The other party's name, only when the server sent one. */}
      {!mine && message.senderName ? (
        <Text className="mb-0.5 text-[11.5px] font-medium text-ink-subtle">
          {message.senderName}
        </Text>
      ) : null}
      <Text
        className={cn(
          "text-[14px] leading-5",
          mine ? "text-white" : "text-ink",
        )}
      >
        {message.body}
      </Text>
      <Text
        className={cn(
          "mt-1 text-[10.5px]",
          mine ? "text-white/70" : "text-ink-subtle",
        )}
      >
        {new Date(message.createdAt).toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
    </View>
  );
}
