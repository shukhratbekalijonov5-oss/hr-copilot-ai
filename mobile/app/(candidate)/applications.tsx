import { FlatList, View } from "react-native";
import {
  Badge,
  Body,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorState,
  SectionTitle,
} from "@/components/ui/index";
import { ApplicationTimeline } from "@/components/candidate/ApplicationTimeline";
import { BriefcaseIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { useMyApplications } from "@/features/candidate/queries";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";
import { candidateStageTone } from "@/lib/candidate/status";

/**
 * The candidate's own applications.
 *
 * A `FlatList` rather than a ScrollView: this list is unbounded, and mapping
 * it into a scroll view would mount every row on a phone with limited memory.
 */
export default function ApplicationsScreen() {
  const { d } = useI18n();
  const applications = useMyApplications();

  if (applications.isLoading) {
    return (
      <View className="px-4 pt-4">
        <CardSkeleton rows={4} />
      </View>
    );
  }

  if (applications.isError) {
    return (
      <View className="px-4 pt-4">
        <ErrorState
          title={d.common.somethingWentWrong}
          retryLabel={d.common.retry}
          onRetry={() => void applications.refetch()}
        />
      </View>
    );
  }

  const rows = applications.rows;

  if (rows.length === 0) {
    return (
      <View className="px-4 pt-4">
        <EmptyState
          icon={<BriefcaseIcon size={20} color="#968e9c" />}
          title={d.applications.empty}
          description={d.applications.emptyHint}
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
      {...infiniteListProps(applications)}
      ListFooterComponent={<ListFooter loading={applications.isFetchingNextPage} />}
      renderItem={({ item }) => (
        <Card className="gap-3">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1">
              <SectionTitle>{item.job.title}</SectionTitle>
              <Body className="mt-0.5">{item.job.organizationName}</Body>
            </View>
            <Badge
              label={d.applications[stageKey(item.status)]}
              tone={candidateStageTone(item.status)}
            />
          </View>
          {/* Derived from the stored status only — no invented stage history. */}
          <ApplicationTimeline status={item.status} />
        </Card>
      )}
    />
  );
}

function stageKey(status: string): "applied" | "review" | "interview" | "decision" {
  if (status === "REVIEWING") return "review";
  if (status === "INTERVIEW") return "interview";
  if (status === "NEW") return "applied";
  return "decision";
}
