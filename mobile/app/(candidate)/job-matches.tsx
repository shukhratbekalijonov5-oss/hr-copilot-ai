import { router } from "expo-router";
import { FlatList, View } from "react-native";
import { AiCard, Badge, Body, Button, Card, CardSkeleton, EmptyState, SectionTitle } from "@/components/ui/index";
import { LockIcon, SparkIcon } from "@/components/navigation/icons";
import { useI18n, format } from "@/lib/i18n/index";
import { useSessionUser } from "@/lib/auth/context";
import { allows, requiredPlanFor } from "@/lib/auth/entitlements";
import { useEvidenceState, useJobMatches } from "@/features/candidate/queries";
import { ApiError, API_CODES } from "@/lib/api/errors";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";

/**
 * Internal AI job matches — the candidate's signature screen.
 *
 * ## The lock is drawn before the request, and again after it
 *
 * If the session says the plan does not include internal AI search, no query
 * runs at all. If the session was stale and the backend answers 403
 * `PLAN_UPGRADE_REQUIRED`, the same paywall renders from the error. The
 * backend is the authority in both directions; the local check only avoids a
 * pointless round trip.
 */
export default function JobMatchesScreen() {
  const { d, locale } = useI18n();
  const user = useSessionUser();
  const evidence = useEvidenceState();

  const entitled = allows(user, "INTERNAL_AI_SEARCH");
  const matches = useJobMatches(
    locale,
    entitled && (evidence.data?.canRunJobMatch ?? false),
  );

  const deniedByServer =
    matches.error instanceof ApiError &&
    matches.error.code === API_CODES.PLAN_UPGRADE_REQUIRED;

  if (!entitled || deniedByServer) {
    return (
      <View className="px-4 pt-4">
        <EmptyState
          icon={<LockIcon size={20} color="#968e9c" />}
          title={format(d.entitlement.lockedTitle, {
            plan: requiredPlanFor("INTERNAL_AI_SEARCH"),
          })}
          description={d.entitlement.lockedHint}
          action={
            <Button
              title={d.entitlement.viewPlans}
              variant="secondary"
              onPress={() => router.navigate("/(candidate)/plans" as never)}
            />
          }
        />
      </View>
    );
  }

  if (matches.isLoading) return <View className="px-4 pt-4"><CardSkeleton rows={3} /></View>;

  const rows = matches.matches;
  if (rows.length === 0) {
    return (
      <View className="px-4 pt-4">
        <EmptyState icon={<SparkIcon size={20} color="#968e9c" />} title={d.jobMatch.empty} description={d.jobMatch.emptyHint} />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.vacancy.slug}
      contentContainerClassName="px-4 pb-8 pt-4 gap-3"
      showsVerticalScrollIndicator={false}
      {...infiniteListProps(matches)}
      ListFooterComponent={<ListFooter loading={matches.isFetchingNextPage} />}
      renderItem={({ item }) => (
        <Card className="gap-2">
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1 gap-1">
              <View className="flex-row gap-1.5">
                <Badge label={d.jobMatch.band[item.band]} tone="brand" />
                <Badge label={d.jobMatch.sourceInternal} tone="neutral" />
              </View>
              <SectionTitle className="mt-1">{item.vacancy.title}</SectionTitle>
              <Body>{item.vacancy.organizationName}</Body>
              {item.vacancy.location ? <Body className="text-[12px]">{item.vacancy.location}</Body> : null}
            </View>
            <View className="items-end">
              <SectionTitle>{Math.round(item.score)}</SectionTitle>
              <Body className="text-[11px]">{d.jobMatch.score}</Body>
            </View>
          </View>
          {item.explanation ? (
            <AiCard>
              <Body className="text-ink">{item.explanation}</Body>
            </AiCard>
          ) : null}
        </Card>
      )}
    />
  );
}
