import { FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { Badge, Body, Card, CardSkeleton, EmptyState, ErrorState, SectionTitle } from "@/components/ui/index";
import { MessageIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { useConversations } from "@/features/chat/queries";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";

/**
 * Interview conversations.
 *
 * One component, two audiences — the endpoints differ because the backend
 * scopes them differently, and that scoping is the backend's rule. Nothing
 * here filters by role locally.
 */
export function ChatsScreen({ audience }: { audience: "candidate" | "recruiter" }) {
  const { d } = useI18n();
  const conversations = useConversations(audience);

  if (conversations.isLoading) return <View className="px-4 pt-4"><CardSkeleton rows={4} /></View>;
  if (conversations.isError) {
    return (
      <View className="px-4 pt-4">
        <ErrorState title={d.common.somethingWentWrong} retryLabel={d.common.retry} onRetry={() => void conversations.refetch()} />
      </View>
    );
  }

  const rows = conversations.rows;
  if (rows.length === 0) {
    return (
      <View className="px-4 pt-4">
        <EmptyState
          icon={<MessageIcon size={20} color="#968e9c" />}
          title={d.chat.empty}
          description={audience === "candidate" ? d.chat.emptyHint : d.chat.emptyHintRecruiter}
        />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      contentContainerClassName="px-4 pb-8 pt-4 gap-3"
      showsVerticalScrollIndicator={false}
      {...infiniteListProps(conversations)}
      ListFooterComponent={<ListFooter loading={conversations.isFetchingNextPage} />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={item.counterpartName ?? item.vacancyTitle ?? ""}
          onPress={() =>
            router.push({
              pathname:
                audience === "candidate"
                  ? "/(candidate)/chat/[id]"
                  : "/(recruiter)/chat/[id]",
              params: {
                id: item.id,
                title: item.vacancyTitle ?? item.counterpartName ?? "",
              },
            } as never)
          }
          className="active:opacity-70"
        >
        <Card className="gap-1">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <SectionTitle>{item.counterpartName ?? item.vacancyTitle ?? "—"}</SectionTitle>
              {item.vacancyTitle && item.counterpartName ? (
                <Body className="mt-0.5 text-[12px]">{item.vacancyTitle}</Body>
              ) : null}
            </View>
            {item.unreadCount ? <Badge label={String(item.unreadCount)} tone="brand" /> : null}
          </View>
          {item.lastMessagePreview ? (
            <Body numberOfLines={1}>{item.lastMessagePreview}</Body>
          ) : null}
        </Card>
        </Pressable>
      )}
    />
  );
}
