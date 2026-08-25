import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import {
  AiCard,
  Badge,
  Body,
  Button,
  Card,
  CardSkeleton,
  EmptyState,
  SectionTitle,
  Stat,
  Title,
} from "@/components/ui/index";
import { AmbientGlow } from "@/components/navigation/GridBackground";
import { SparkIcon } from "@/components/navigation/icons";
import { useSessionUser } from "@/lib/auth/context";
import { allows } from "@/lib/auth/entitlements";
import { format, useI18n } from "@/lib/i18n/index";
import {
  useEvidenceState,
  useJobMatches,
  useMyApplications,
  useSavedJobs,
} from "@/features/candidate/queries";

/**
 * The job seeker's home.
 *
 * ## Every number came from the server
 *
 * There is no derived score and no placeholder row. Each panel reads one
 * existing endpoint, and a count that failed to load renders as an em dash —
 * "you have 0 saved jobs" and "we could not reach the server" are different
 * sentences, and only one of them is true.
 *
 * ## The expensive query is gated twice
 *
 * Ranking is a POST that can touch the whole catalogue, so it runs only when
 * the plan allows it AND the account has evidence to rank. Neither check is
 * a security boundary — the backend refuses regardless — they just avoid
 * spending a ranking pass to render an empty list.
 */
export function CandidateDashboardScreen() {
  const { d, locale } = useI18n();
  const user = useSessionUser();

  const applications = useMyApplications();
  const saved = useSavedJobs();
  const evidence = useEvidenceState();
  const canMatch =
    allows(user, "INTERNAL_AI_SEARCH") && (evidence.data?.canRunJobMatch ?? false);
  const matches = useJobMatches(locale, canMatch);

  /*
   * Counted from the FIRST page only, which is what this stat can honestly
   * claim — the dashboard loads one page, so a candidate with more than a
   * page of applications would otherwise see a number that grows as they
   * scroll a different screen.
   */
  const activeCount = applications.rows.filter((row) =>
    ["NEW", "REVIEWING", "INTERVIEW", "OFFER"].includes(row.status),
  ).length;

  const show = (value: number | undefined) =>
    value === undefined ? "—" : String(value);

  return (
    <ScrollView
      contentContainerClassName="px-4 pb-8 pt-4 gap-5"
      showsVerticalScrollIndicator={false}
    >
      <View className="overflow-hidden rounded-card border border-line bg-surface-raised p-5">
        <AmbientGlow />
        <View className="gap-2">
          <Title>
            {format(d.dashboard.greeting, {
              name: user.fullName.split(" ")[0] || user.fullName,
            })}
          </Title>
          <Body>{d.dashboard.candidateSubtitle}</Body>
        </View>
        <View className="mt-4 flex-row gap-2">
          <Button
            title={d.dashboard.findMatchingJobs}
            className="flex-1"
            onPress={() => router.navigate("/(candidate)/job-matches" as never)}
          />
        </View>
      </View>

      <View className="flex-row gap-3">
        <Stat label={d.dashboard.activeApplications} value={show(activeCount)} />
        <Stat label={d.dashboard.savedJobs} value={show(saved.total)} />
        <Stat label={d.dashboard.evidence} value={show(evidence.data?.total)} />
      </View>

      <View className="gap-3">
        <SectionTitle>{d.dashboard.topMatches}</SectionTitle>

        {matches.isLoading ? (
          <CardSkeleton rows={2} />
        ) : !canMatch || matches.matches.length === 0 ? (
          <EmptyState
            icon={<SparkIcon size={20} color="#968e9c" />}
            title={d.jobMatch.empty}
            description={d.jobMatch.emptyHint}
            action={
              <Button
                title={d.dashboard.findMatchingJobs}
                variant="secondary"
                onPress={() => router.navigate("/(candidate)/job-matches" as never)}
              />
            }
          />
        ) : (
          matches.matches.slice(0, 3).map((match) => (
            <Card key={match.vacancy.slug} className="gap-2">
              <View className="flex-row items-start justify-between gap-3">
                <View className="min-w-0 flex-1 gap-1">
                  <Badge label={d.jobMatch.band[match.band]} tone="brand" />
                  <SectionTitle className="mt-1">{match.vacancy.title}</SectionTitle>
                  <Body>{match.vacancy.organizationName}</Body>
                </View>
                <View className="items-end">
                  <SectionTitle>{Math.round(match.score)}</SectionTitle>
                  <Body className="text-[11px]">{d.jobMatch.score}</Body>
                </View>
              </View>
              {match.explanation ? (
                <AiCard className="mt-1">
                  <Body className="text-ink">{match.explanation}</Body>
                </AiCard>
              ) : null}
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  );
}
