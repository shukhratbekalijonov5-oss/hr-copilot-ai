import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import {
  Body,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorState,
  Meta,
  SectionTitle,
} from "@/components/ui/index";
import { UsersIcon } from "@/components/navigation/icons";
import { VacancyPicker } from "@/components/recruiter/VacancyPicker";
import { useI18n } from "@/lib/i18n/index";
import { useOrgCandidates } from "@/features/recruiter/candidates";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";

/**
 * The applicants to this organization's vacancies.
 *
 * ## The row leads to detail, and carries the vacancy with it
 *
 * Candidate detail is reached from here and never from the tab bar, because
 * a candidate outside a vacancy context has no evidence to show. The vacancy
 * travels in the route so a back navigation, a deep link and a cold launch
 * all land on the same scoped view.
 */
export default function RecruiterCandidatesScreen() {
  const { d } = useI18n();
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const candidates = useOrgCandidates(vacancyId);

  const rows = candidates.rows;

  return (
    <View className="flex-1">
      <View className="border-b border-line bg-surface">
        <VacancyPicker value={vacancyId} onChange={setVacancyId} allowAll />
      </View>

      {candidates.isLoading ? (
        <View className="px-4 pt-4">
          <CardSkeleton rows={4} />
        </View>
      ) : candidates.isError ? (
        <View className="px-4 pt-4">
          <ErrorState
            title={d.common.somethingWentWrong}
            retryLabel={d.common.retry}
            onRetry={() => void candidates.refetch()}
          />
        </View>
      ) : rows.length === 0 ? (
        <View className="px-4 pt-4">
          <EmptyState
            icon={<UsersIcon size={20} color="#8393ac" />}
            title={d.candidates.empty}
            description={d.candidates.emptyHint}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-8 pt-4 gap-3"
          showsVerticalScrollIndicator={false}
          {...infiniteListProps(candidates)}
          ListFooterComponent={<ListFooter loading={candidates.isFetchingNextPage} />}
          refreshControl={
            <RefreshControl
              refreshing={candidates.isRefetching && !candidates.isFetchingNextPage}
              onRefresh={() => void candidates.refetch()}
            />
          }
          renderItem={({ item }) => {
            /*
             * The vacancy this row was listed under. When the list is
             * unscoped the row's own primary vacancy is used, so detail
             * still opens with a context rather than an empty one.
             */
            const scoped = vacancyId ?? item.primaryVacancyId ?? null;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.fullName}
                onPress={() =>
                  router.push({
                    pathname: "/(recruiter)/candidates/[id]",
                    params: { id: item.id, ...(scoped ? { vacancyId: scoped } : {}) },
                  } as never)
                }
                className="active:opacity-70"
              >
                <Card className="gap-1">
                  <SectionTitle>{item.fullName}</SectionTitle>
                  {item.currentTitle ? <Body>{item.currentTitle}</Body> : null}
                  <View className="mt-0.5 flex-row flex-wrap gap-x-3 gap-y-1">
                    {item.location ? <Meta>{item.location}</Meta> : null}
                    {/* Only when the server sent a number — absent is not 0. */}
                    {typeof item.totalExperienceYears === "number" ? (
                      <Meta>
                        {item.totalExperienceYears} {d.profile.experience}
                      </Meta>
                    ) : null}
                  </View>
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
