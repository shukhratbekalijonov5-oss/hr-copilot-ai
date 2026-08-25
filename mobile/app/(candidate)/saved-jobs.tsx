import { FlatList, RefreshControl, View } from "react-native";
import { Badge, Body, Card, CardSkeleton, EmptyState, ErrorState, SectionTitle } from "@/components/ui/index";
import { BookmarkIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { useSavedJobs } from "@/features/candidate/queries";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";

export default function SavedJobsScreen() {
  const { d } = useI18n();
  const saved = useSavedJobs();

  if (saved.isLoading) return <View className="px-4 pt-4"><CardSkeleton rows={4} /></View>;
  if (saved.isError) {
    return (
      <View className="px-4 pt-4">
        <ErrorState title={d.common.somethingWentWrong} retryLabel={d.common.retry} onRetry={() => void saved.refetch()} />
      </View>
    );
  }

  const rows = saved.rows;
  if (rows.length === 0) {
    return (
      <View className="px-4 pt-4">
        <EmptyState icon={<BookmarkIcon size={20} color="#968e9c" />} title={d.savedJobs.empty} description={d.savedJobs.emptyHint} />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.job.publicSlug}
      contentContainerClassName="px-4 pb-8 pt-4 gap-3"
      showsVerticalScrollIndicator={false}
      {...infiniteListProps(saved)}
      ListFooterComponent={<ListFooter loading={saved.isFetchingNextPage} />}
      refreshControl={
        <RefreshControl
          refreshing={saved.isRefetching && !saved.isFetchingNextPage}
          onRefresh={() => void saved.refetch()}
        />
      }
      renderItem={({ item }) => (
        <Card className="gap-1.5">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <SectionTitle>{item.job.title}</SectionTitle>
              <Body className="mt-0.5">{item.job.organizationName}</Body>
            </View>
            {/* A bookmark whose job closed is still real, but is flagged. */}
            {item.job.status !== "OPEN" ? <Badge label={item.job.status} tone="neutral" /> : null}
          </View>
        </Card>
      )}
    />
  );
}
