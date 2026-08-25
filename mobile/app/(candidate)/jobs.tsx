import { useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
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
import { SearchIcon } from "@/components/navigation/icons";
import { format, useI18n } from "@/lib/i18n/index";
import { useApplyToJob, usePublicJobs, useSaveJob } from "@/features/jobs/queries";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";
import { ApiError } from "@/lib/api/errors";
import type { PublicJob } from "@/types";

/**
 * Ordinary job search.
 *
 * ## The query and the location are the only filters
 *
 * That is the backend's contract. Work mode, employment type, seniority and
 * pay affect the ORDER of these results, not their membership — so this
 * screen offers two inputs and says so in a note, rather than a filter sheet
 * whose switches would appear to exclude and quietly would not.
 *
 * ## Nothing is searched until something is typed
 *
 * An empty query returns the whole catalogue, which on a phone is a
 * thousand-row list nobody asked for. The idle state invites a search rather
 * than pretending to have answered one.
 */
export default function NormalJobSearchScreen() {
  const { d } = useI18n();
  const [queryInput, setQueryInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  /*
   * Submitted values, not keystrokes. The list re-queries when the reader
   * says so — searching per character would fire a request per letter and
   * make the result list flicker through answers to questions half-typed.
   */
  const [submitted, setSubmitted] = useState<{
    query: string;
    location: string;
  } | null>(null);

  const jobs = usePublicJobs(
    submitted?.query ?? "",
    submitted?.location ?? "",
    submitted !== null,
  );
  const apply = useApplyToJob();
  const save = useSaveJob();
  const [actioned, setActioned] = useState<Record<string, "applied" | "saved">>({});

  function runSearch() {
    void Haptics.selectionAsync();
    setSubmitted({ query: queryInput.trim(), location: locationInput.trim() });
  }

  const rows = jobs.rows;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="gap-2 border-b border-line bg-surface px-4 pb-3 pt-3">
        <View className="flex-row items-center gap-2 rounded-control border border-line bg-surface-muted px-3">
          <SearchIcon size={16} color="#8393ac" />
          <TextInput
            value={queryInput}
            onChangeText={setQueryInput}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder={d.jobs.searchPlaceholder}
            accessibilityLabel={d.jobs.searchPlaceholder}
            className="min-h-[44px] flex-1 text-[14px] text-ink"
          />
        </View>
        <View className="flex-row gap-2">
          <TextInput
            value={locationInput}
            onChangeText={setLocationInput}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            placeholder={d.jobs.locationPlaceholder}
            accessibilityLabel={d.jobs.locationPlaceholder}
            className="min-h-[44px] flex-1 rounded-control border border-line bg-surface-muted px-3 text-[14px] text-ink"
          />
          <Button title={d.jobs.search} onPress={runSearch} className="px-5" />
        </View>
        <Meta>{d.jobs.rankingNote}</Meta>
      </View>

      {submitted === null ? (
        <View className="px-4 pt-4">
          <EmptyState
            icon={<SearchIcon size={20} color="#8393ac" />}
            title={d.jobs.startTitle}
            description={d.jobs.startHint}
          />
        </View>
      ) : jobs.isLoading ? (
        <View className="px-4 pt-4">
          <CardSkeleton rows={4} />
        </View>
      ) : jobs.isError ? (
        <View className="px-4 pt-4">
          <ErrorState
            title={d.common.somethingWentWrong}
            retryLabel={d.common.retry}
            onRetry={() => void jobs.refetch()}
          />
        </View>
      ) : rows.length === 0 ? (
        <View className="px-4 pt-4">
          <EmptyState title={d.jobs.empty} description={d.jobs.emptyHint} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.publicSlug}
          contentContainerClassName="px-4 pb-8 pt-4 gap-3"
          showsVerticalScrollIndicator={false}
          {...infiniteListProps(jobs)}
          ListFooterComponent={<ListFooter loading={jobs.isFetchingNextPage} />}
          refreshControl={
            <RefreshControl
              refreshing={jobs.isRefetching && !jobs.isFetchingNextPage}
              onRefresh={() => void jobs.refetch()}
            />
          }
          renderItem={({ item }) => (
            <JobRow
              job={item}
              state={actioned[item.publicSlug]}
              busy={apply.isPending || save.isPending}
              onApply={async () => {
                try {
                  await apply.mutateAsync(item.publicSlug);
                  void Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                  setActioned((current) => ({
                    ...current,
                    [item.publicSlug]: "applied",
                  }));
                } catch (error) {
                  /*
                   * A 409 means an application already exists. That is the
                   * end state the reader wanted, so it resolves the button
                   * rather than reporting a failure they cannot act on.
                   */
                  if (error instanceof ApiError && error.status === 409) {
                    setActioned((current) => ({
                      ...current,
                      [item.publicSlug]: "applied",
                    }));
                  }
                }
              }}
              onSave={() => {
                void Haptics.selectionAsync();
                save.mutate({ slug: item.publicSlug, saved: false });
                setActioned((current) => ({
                  ...current,
                  [item.publicSlug]: "saved",
                }));
              }}
            />
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function JobRow({
  job,
  state,
  busy,
  onApply,
  onSave,
}: {
  job: PublicJob;
  state: "applied" | "saved" | undefined;
  busy: boolean;
  onApply: () => void;
  onSave: () => void;
}) {
  const { d } = useI18n();
  const open = job.status === "OPEN";

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <SectionTitle>{job.title}</SectionTitle>
          <Body className="mt-0.5">{job.organizationName}</Body>
        </View>
        {open ? null : <Badge label={d.jobs.closed} tone="neutral" />}
      </View>

      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        {job.location ? <Meta>{job.location}</Meta> : null}
        {job.employmentType ? <Meta>{job.employmentType}</Meta> : null}
        {/* Rendered only when the server actually sent a count — a missing
            number is not zero applicants. */}
        {typeof job.applicantCount === "number" ? (
          <Meta>{format(d.jobs.applicants, { count: job.applicantCount })}</Meta>
        ) : null}
      </View>

      {open ? (
        <View className="mt-1 flex-row gap-2">
          <Button
            title={state === "applied" ? d.jobs.applied : d.jobs.apply}
            onPress={onApply}
            disabled={busy || state === "applied"}
            className="flex-1"
          />
          <Button
            title={state === "saved" ? d.jobs.saved : d.jobs.save}
            variant="secondary"
            onPress={onSave}
            disabled={busy || state === "saved"}
            className="flex-1"
          />
        </View>
      ) : null}
    </Card>
  );
}
