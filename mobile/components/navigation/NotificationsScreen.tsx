import { FlatList, View } from "react-native";
import { Body, Button, Card, CardSkeleton, EmptyState, ErrorState, SectionTitle } from "@/components/ui/index";
import { BellIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { ApiError, API_CODES } from "@/lib/api/errors";
import { useMarkAllRead, useMarkRead, useNotifications } from "@/features/notifications/queries";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";
import { cn } from "@/lib/utils";

/**
 * The notification centre.
 *
 * Contract untouched: list, mark one read, mark all read. A backend outage
 * answers a stable `NOTIFICATIONS_UNAVAILABLE`, which renders as localized
 * copy rather than the server's English prose — and never as an empty list,
 * which would tell somebody their notifications were deleted.
 */
export function NotificationsScreen() {
  const { d } = useI18n();
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  if (notifications.isLoading) return <View className="px-4 pt-4"><CardSkeleton rows={5} /></View>;

  if (notifications.isError) {
    const unavailable =
      notifications.error instanceof ApiError &&
      notifications.error.code === API_CODES.NOTIFICATIONS_UNAVAILABLE;
    return (
      <View className="px-4 pt-4">
        <ErrorState
          title={unavailable ? d.notifications.unavailable : d.common.somethingWentWrong}
          retryLabel={d.common.retry}
          onRetry={() => void notifications.refetch()}
        />
      </View>
    );
  }

  const rows = notifications.rows;
  if (rows.length === 0) {
    return (
      <View className="px-4 pt-4">
        <EmptyState icon={<BellIcon size={20} color="#968e9c" />} title={d.notifications.empty} description={d.notifications.emptyHint} />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="px-4 pt-3">
        <Button
          title={d.notifications.markAllRead}
          variant="secondary"
          loading={markAll.isPending}
          onPress={() => markAll.mutate()}
          className="self-start"
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-4 pb-8 pt-3 gap-2"
        showsVerticalScrollIndicator={false}
        {...infiniteListProps(notifications)}
        ListFooterComponent={<ListFooter loading={notifications.isFetchingNextPage} />}
        renderItem={({ item }) => (
          <Card
            className={cn("gap-1", !item.isRead && "border-brand/30 bg-brand-soft/40")}
            onTouchEnd={() => {
              if (!item.isRead) markRead.mutate(item.id);
            }}
          >
            <SectionTitle>{item.vacancyTitle ?? item.candidateName ?? item.type}</SectionTitle>
            {item.messagePreview ? <Body numberOfLines={2}>{item.messagePreview}</Body> : null}
          </Card>
        )}
      />
    </View>
  );
}
