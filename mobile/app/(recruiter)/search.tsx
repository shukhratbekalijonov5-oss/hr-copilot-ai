import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
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
import { VacancyPicker } from "@/components/recruiter/VacancyPicker";
import { format, useI18n } from "@/lib/i18n/index";
import { useEvidenceSearch } from "@/features/recruiter/candidates";

/**
 * Internal AI search over the organization's own applicants' evidence.
 *
 * ## Every hit is a passage from a real document
 *
 * The result is not a generated answer — it is the text that was found, with
 * the file it came from. That is the product's whole claim: a recruiter can
 * read the sentence themselves rather than trusting a summary of it, which
 * is why the snippet is shown verbatim and the source is never omitted.
 *
 * ## It searches only what this organization may see
 *
 * Scope is the backend's: the query runs against applicants to the caller's
 * own vacancies. Narrowing to one vacancy here is a convenience on top of
 * that boundary, not the boundary itself.
 */
export default function RecruiterSearchScreen() {
  const { d } = useI18n();
  const [query, setQuery] = useState("");
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const search = useEvidenceSearch();

  function run() {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    void Haptics.selectionAsync();
    search.mutate({ query: trimmed, vacancyId });
  }

  const hits = search.data?.hits ?? [];

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="border-b border-line bg-surface">
        <View className="gap-2 px-4 pb-1 pt-3">
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={run}
            returnKeyType="search"
            multiline
            placeholder={d.hrSearch.placeholder}
            accessibilityLabel={d.hrSearch.placeholder}
            placeholderTextColor="#8393ac"
            className="min-h-[56px] rounded-control border border-line bg-surface-muted px-3 py-2 text-[14px] text-ink"
          />
          <Meta>{d.hrSearch.subtitle}</Meta>
        </View>
        <VacancyPicker value={vacancyId} onChange={setVacancyId} allowAll />
        <View className="px-4 pb-3">
          <Button
            title={search.isPending ? d.hrSearch.searching : d.hrSearch.run}
            loading={search.isPending}
            disabled={query.trim().length === 0}
            onPress={run}
          />
        </View>
      </View>

      <ScrollView
        contentContainerClassName="px-4 pb-10 pt-4 gap-3"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {search.isPending ? (
          <CardSkeleton rows={3} />
        ) : search.isError ? (
          <ErrorState
            title={d.common.somethingWentWrong}
            retryLabel={d.common.retry}
            onRetry={run}
          />
        ) : search.isIdle ? (
          <EmptyState
            icon={<SearchIcon size={20} color="#8393ac" />}
            title={d.hrSearch.title}
            description={d.hrSearch.subtitle}
          />
        ) : hits.length === 0 ? (
          <EmptyState
            title={d.hrSearch.noResults}
            description={d.hrSearch.noResultsHint}
          />
        ) : (
          hits.map((hit, index) => (
            <Card key={`${hit.candidateId}-${index}`} className="gap-2">
              <SectionTitle>{hit.candidateName}</SectionTitle>
              {/* Verbatim. A paraphrase here would be our words presented
                  as the candidate's document. */}
              <View className="rounded-control border-l-2 border-brand bg-surface-muted p-3">
                <Body>{hit.snippet}</Body>
              </View>
              <View className="flex-row flex-wrap gap-x-3">
                {hit.documentName ? (
                  <Meta>
                    {format(d.hrSearch.citedFrom, { document: hit.documentName })}
                  </Meta>
                ) : null}
                {typeof hit.page === "number" ? (
                  <Meta>{format(d.hrSearch.page, { page: hit.page })}</Meta>
                ) : null}
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
