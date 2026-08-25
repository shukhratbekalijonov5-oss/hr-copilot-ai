import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AiCard,
  Badge,
  Body,
  Button,
  Card,
  CardSkeleton,
  EmptyState,
  ErrorState,
  Meta,
  SectionTitle,
} from "@/components/ui/index";
import { GlobeIcon, LockIcon } from "@/components/navigation/icons";
import { format, useI18n } from "@/lib/i18n/index";
import { useSessionUser } from "@/lib/auth/context";
import { allows, requiredPlanFor } from "@/lib/auth/entitlements";
import { API_CODES, ApiError } from "@/lib/api/errors";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";
import {
  useExternalSearch,
  useSaveExternalJob,
  useWhyMatch,
} from "@/features/external/queries";
import type { ExternalJob } from "@/types";

/**
 * External AI job search — roles published on other companies' boards.
 *
 * ## Applying happens somewhere else, and the screen says so
 *
 * We never learn the outcome of an external application, so there is no
 * "Applied" state to claim here. The action is an honest "Apply on company
 * site" that opens their page. Presenting an internal-looking Apply button
 * would promise a pipeline this product does not have.
 *
 * ## Nothing about a posting date is inferred
 *
 * Several providers publish no date at all. When `employerPostedAt` is null
 * the row says the date is not published rather than substituting the moment
 * our crawler saw it, which would be presenting our timestamp as theirs.
 */
export default function ExternalJobsScreen() {
  const { d, locale } = useI18n();
  const user = useSessionUser();
  const [queryInput, setQueryInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const entitled = allows(user, "EXTERNAL_AI_SEARCH");
  const search = useExternalSearch(
    submitted ?? "",
    [],
    entitled && submitted !== null,
  );
  const save = useSaveExternalJob();

  const deniedByServer =
    search.error instanceof ApiError &&
    search.error.code === API_CODES.PLAN_UPGRADE_REQUIRED;

  /*
   * The lock is drawn before the request and again after it. A stale session
   * that thinks it is entitled still meets the backend's 403, and both paths
   * render the same paywall — the server is the authority in each direction.
   */
  if (!entitled || deniedByServer) {
    return (
      <View className="px-4 pt-4">
        <EmptyState
          icon={<LockIcon size={20} color="#8393ac" />}
          title={format(d.entitlement.lockedTitle, {
            plan: requiredPlanFor("EXTERNAL_AI_SEARCH"),
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

  const rows = search.results;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="gap-2 border-b border-line bg-surface px-4 pb-3 pt-3">
        <View className="flex-row gap-2">
          <TextInput
            value={queryInput}
            onChangeText={setQueryInput}
            onSubmitEditing={() => setSubmitted(queryInput.trim())}
            returnKeyType="search"
            placeholder={d.externalJobs.searchPlaceholder}
            accessibilityLabel={d.externalJobs.searchPlaceholder}
            className="min-h-[44px] flex-1 rounded-control border border-line bg-surface-muted px-3 text-[14px] text-ink"
          />
          <Button
            title={d.jobs.search}
            onPress={() => {
              void Haptics.selectionAsync();
              setSubmitted(queryInput.trim());
            }}
            className="px-5"
          />
        </View>
        {/* Stated when the backend says a source was unavailable, so an
            unexpectedly short list is explained rather than assumed. */}
        {search.degraded ? (
          <Meta className="text-warning">{d.externalJobs.degraded}</Meta>
        ) : null}
      </View>

      {submitted === null ? (
        <View className="px-4 pt-4">
          <EmptyState
            icon={<GlobeIcon size={20} color="#8393ac" />}
            title={d.externalJobs.startTitle}
            description={d.externalJobs.startHint}
          />
        </View>
      ) : search.isLoading ? (
        <View className="px-4 pt-4">
          <CardSkeleton rows={4} />
        </View>
      ) : search.isError ? (
        <View className="px-4 pt-4">
          <ErrorState
            title={d.common.somethingWentWrong}
            retryLabel={d.common.retry}
            onRetry={() => void search.refetch()}
          />
        </View>
      ) : rows.length === 0 ? (
        <View className="px-4 pt-4">
          <EmptyState
            title={d.externalJobs.empty}
            description={d.externalJobs.emptyHint}
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.externalJobId}
          contentContainerClassName="px-4 pb-8 pt-4 gap-3"
          showsVerticalScrollIndicator={false}
          {...infiniteListProps(search)}
          ListFooterComponent={<ListFooter loading={search.isFetchingNextPage} />}
          refreshControl={
            <RefreshControl
              refreshing={search.isRefetching && !search.isFetchingNextPage}
              onRefresh={() => void search.refetch()}
            />
          }
          renderItem={({ item }) => (
            <ExternalJobRow
              job={item}
              locale={locale}
              onSave={() => {
                void Haptics.selectionAsync();
                save.mutate({
                  id: item.externalJobId,
                  saved: Boolean(item.saved),
                });
              }}
            />
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function ExternalJobRow({
  job,
  locale,
  onSave,
}: {
  job: ExternalJob;
  locale: string;
  onSave: () => void;
}) {
  const { d } = useI18n();
  const whyMatch = useWhyMatch();

  const place = [job.location.city, job.location.region, job.location.countryCode]
    .filter(Boolean)
    .join(", ");

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <SectionTitle>{job.title}</SectionTitle>
          <Body className="mt-0.5">{job.company}</Body>
        </View>
        {/* The backend's rank, labelled as a rank. It is not a probability
            of being hired, and a bare percentage would read as one. */}
        <Badge
          label={`${d.externalJobs.scoreLabel} ${Math.round(job.score)}`}
          tone="brand"
        />
      </View>

      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        {place ? <Meta>{place}</Meta> : null}
        {job.employmentType ? <Meta>{job.employmentType}</Meta> : null}
        <Meta>
          {job.employerPostedAt
            ? format(d.externalJobs.postedOn, {
                date: new Date(job.employerPostedAt).toLocaleDateString(locale),
              })
            : d.externalJobs.postedUnknown}
        </Meta>
      </View>

      {job.provenance?.primarySource ? (
        <Meta>
          {d.externalJobs.source}: {job.provenance.primarySource}
        </Meta>
      ) : null}

      {whyMatch.data ? (
        <AiCard className="mt-1">
          <SectionTitle className="text-ai-ink">
            {d.externalJobs.whyMatch}
          </SectionTitle>
          <Body className="mt-1.5">{whyMatch.data.text}</Body>
        </AiCard>
      ) : null}

      <View className="mt-1 flex-row flex-wrap gap-2">
        {job.applyUrl ? (
          <Button
            title={d.externalJobs.applyOnSite}
            onPress={() => void Linking.openURL(job.applyUrl as string)}
            className="flex-1"
          />
        ) : null}
        <Button
          title={job.saved ? d.jobs.saved : d.jobs.save}
          variant="secondary"
          onPress={onSave}
        />
      </View>

      {whyMatch.data ? null : (
        <Button
          title={
            whyMatch.isPending
              ? d.externalJobs.generating
              : d.externalJobs.generateWhyMatch
          }
          variant="ghost"
          loading={whyMatch.isPending}
          onPress={() => whyMatch.mutate(job.externalJobId)}
          className="self-start"
        />
      )}
    </Card>
  );
}
