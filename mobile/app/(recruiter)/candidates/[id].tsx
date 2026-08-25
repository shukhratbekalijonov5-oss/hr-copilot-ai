import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  AiCard,
  Badge,
  Body,
  Button,
  Card,
  CardSkeleton,
  EmptyState,
  Meta,
  SectionTitle,
  Title,
  type BadgeTone,
} from "@/components/ui/index";
import { VacancyPicker } from "@/components/recruiter/VacancyPicker";
import { format, useI18n } from "@/lib/i18n/index";
import {
  useAiAnswer,
  useCandidateSummary,
  useEvidenceMap,
  useInterviewQuestions,
  useOrgCandidate,
  useRunEvidenceMap,
  useVacancyDetail,
} from "@/features/recruiter/candidates";
import type { EvidenceStatus } from "@/types";

/**
 * Candidate detail — reached from Candidates, never from the tab bar.
 *
 * ## Vacancy context travels in the URL
 *
 * The active vacancy is a route param rather than store state, so a deep
 * link, a back navigation and a cold launch all land on the same scoped
 * view. Cross-vacancy leakage is prevented by the backend, which scopes
 * every read to the vacancy it is given and refuses one the caller does not
 * own — this screen simply never asks without saying which.
 *
 * ## Nothing generates itself
 *
 * The summary, the interview questions and the evidence map each cost a
 * model pass, so each waits for a press. Firing them on mount would spend
 * three generations every time somebody tapped a row to check a phone
 * number.
 */
type Section = "overview" | "evidence" | "summary" | "questions" | "ask";

export default function CandidateDetailScreen() {
  const { d, locale } = useI18n();
  const params = useLocalSearchParams<{ id: string; vacancyId?: string }>();
  const [section, setSection] = useState<Section>("overview");
  const [vacancyId, setVacancyId] = useState<string | null>(
    params.vacancyId ?? null,
  );

  const candidate = useOrgCandidate(params.id ?? null);
  const vacancy = useVacancyDetail(vacancyId);

  const sections: { id: Section; label: string }[] = [
    { id: "overview", label: d.candidates.overview },
    { id: "evidence", label: d.candidates.evidence },
    { id: "summary", label: d.candidates.summary },
    { id: "questions", label: d.candidates.questions },
    { id: "ask", label: d.candidates.ask },
  ];

  /* Everything except Overview is defined against a vacancy. */
  const needsVacancy = section !== "overview";

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="border-b border-line bg-surface">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-4 py-3 gap-2"
        >
          {sections.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: section === item.id }}
              accessibilityLabel={item.label}
              onPress={() => setSection(item.id)}
              hitSlop={4}
              className={
                section === item.id
                  ? "min-h-[38px] justify-center rounded-full border border-brand bg-brand-soft px-3.5"
                  : "min-h-[38px] justify-center rounded-full border border-line bg-surface px-3.5"
              }
            >
              <Text
                className={
                  section === item.id
                    ? "text-[13px] font-semibold text-brand-ink"
                    : "text-[13px] text-ink-muted"
                }
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* The scope, stated rather than implied — and changeable here. */}
        <View className="border-t border-line">
          <Meta className="px-4 pt-2">{d.candidateDetail.vacancyContext}</Meta>
          <VacancyPicker value={vacancyId} onChange={setVacancyId} />
        </View>
      </View>

      <ScrollView
        contentContainerClassName="px-4 pb-10 pt-4 gap-3"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {candidate.isLoading ? (
          <CardSkeleton rows={2} />
        ) : (
          <Card className="gap-1">
            <Title className="text-[20px]">
              {candidate.data?.fullName ?? "—"}
            </Title>
            {candidate.data?.currentTitle ? (
              <Body>{candidate.data.currentTitle}</Body>
            ) : null}
            <View className="mt-1 flex-row flex-wrap gap-x-3 gap-y-1">
              {candidate.data?.location ? (
                <Meta>{candidate.data.location}</Meta>
              ) : null}
              {typeof candidate.data?.totalExperienceYears === "number" ? (
                <Meta>
                  {candidate.data.totalExperienceYears} {d.profile.experience}
                </Meta>
              ) : null}
            </View>
          </Card>
        )}

        {needsVacancy && !vacancyId ? (
          <EmptyState title={d.candidateDetail.pickVacancy} />
        ) : section === "evidence" ? (
          <EvidenceSection
            candidateId={params.id}
            vacancyId={vacancyId as string}
            locale={locale}
            requirements={vacancy.data?.requirements ?? []}
          />
        ) : section === "summary" ? (
          <SummarySection
            candidateId={params.id}
            vacancyId={vacancyId as string}
            locale={locale}
          />
        ) : section === "questions" ? (
          <QuestionsSection
            candidateId={params.id}
            vacancyId={vacancyId as string}
            locale={locale}
          />
        ) : section === "ask" ? (
          <AskSection vacancyId={vacancyId as string} locale={locale} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const STATUS_TONE: Record<EvidenceStatus, BadgeTone> = {
  STRONG: "positive",
  PARTIAL: "warning",
  GAP: "critical",
  NOT_RUN: "neutral",
};

function useStatusLabel() {
  const { d } = useI18n();
  return (status: EvidenceStatus) =>
    status === "STRONG"
      ? d.compare.statusStrong
      : status === "PARTIAL"
        ? d.compare.statusPartial
        : status === "GAP"
          ? d.compare.statusGap
          : d.compare.statusNotRun;
}

/**
 * Requirement-by-requirement evidence.
 *
 * Every requirement is listed, mapped or not: a requirement missing from the
 * map is NOT_RUN, which is a different fact from "checked, found nothing".
 * Omitting the unmapped ones would make an unfinished analysis look complete.
 */
function EvidenceSection({
  candidateId,
  vacancyId,
  locale,
  requirements,
}: {
  candidateId: string;
  vacancyId: string;
  locale: string;
  requirements: { id: string; text: string; required: boolean }[];
}) {
  const { d } = useI18n();
  const map = useEvidenceMap(candidateId, vacancyId);
  const run = useRunEvidenceMap();
  const label = useStatusLabel();

  if (map.isLoading) return <CardSkeleton rows={3} />;

  const mapped = map.data?.requirements ?? [];

  return (
    <View className="gap-3">
      {map.data?.hasRun === false ? (
        <Card className="gap-2">
          <SectionTitle>{d.candidateDetail.notGenerated}</SectionTitle>
          <Body>{d.candidateDetail.notGeneratedHint}</Body>
        </Card>
      ) : null}

      {requirements.length === 0 ? (
        <EmptyState title={d.compare.noRequirements} />
      ) : (
        requirements.map((requirement) => {
          const entry = mapped.find(
            (item) => item.requirementId === requirement.id,
          );
          const status: EvidenceStatus = entry?.status ?? "NOT_RUN";

          return (
            <Card key={requirement.id} className="gap-2">
              <View className="flex-row items-start justify-between gap-3">
                <Body className="flex-1 text-ink">{requirement.text}</Body>
                <Badge label={label(status)} tone={STATUS_TONE[status]} />
              </View>
              <Meta>
                {requirement.required ? d.compare.required : d.compare.optional}
              </Meta>
              {/* The passage itself, verbatim. A paraphrase would be our
                  words presented as the document's. */}
              {entry?.citations?.[0] ? (
                <View className="rounded-control border-l-2 border-brand bg-surface-muted p-3">
                  <Body>{entry.citations[0].snippet}</Body>
                  {entry.citations[0].documentName ? (
                    <Meta className="mt-1">
                      {format(d.hrSearch.citedFrom, {
                        document: entry.citations[0].documentName,
                      })}
                    </Meta>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })
      )}

      <Button
        title={
          run.isPending
            ? d.candidateDetail.generating
            : map.data?.hasRun
              ? d.candidateDetail.regenerate
              : d.candidateDetail.generate
        }
        loading={run.isPending}
        onPress={() => run.mutate({ candidateId, vacancyId, locale })}
      />
    </View>
  );
}

function SummarySection({
  candidateId,
  vacancyId,
  locale,
}: {
  candidateId: string;
  vacancyId: string;
  locale: string;
}) {
  const { d } = useI18n();
  const summary = useCandidateSummary();

  return (
    <View className="gap-3">
      {summary.data ? (
        <AiCard>
          <Body>{summary.data.summary}</Body>
        </AiCard>
      ) : (
        <Card className="gap-2">
          <SectionTitle>{d.candidateDetail.notGenerated}</SectionTitle>
          <Body>{d.candidateDetail.notGeneratedHint}</Body>
        </Card>
      )}
      <Button
        title={
          summary.isPending
            ? d.candidateDetail.generating
            : summary.data
              ? d.candidateDetail.regenerate
              : d.candidateDetail.generate
        }
        loading={summary.isPending}
        onPress={() => summary.mutate({ candidateId, vacancyId, locale })}
      />
    </View>
  );
}

function QuestionsSection({
  candidateId,
  vacancyId,
  locale,
}: {
  candidateId: string;
  vacancyId: string;
  locale: string;
}) {
  const { d } = useI18n();
  const questions = useInterviewQuestions();

  return (
    <View className="gap-3">
      {questions.data?.questions?.length ? (
        questions.data.questions.map((item, index) => (
          <AiCard key={index}>
            <Body className="text-ink">{item.question}</Body>
            {item.rationale ? <Meta className="mt-1">{item.rationale}</Meta> : null}
          </AiCard>
        ))
      ) : (
        <Card className="gap-2">
          <SectionTitle>{d.candidateDetail.notGenerated}</SectionTitle>
          <Body>{d.candidateDetail.notGeneratedHint}</Body>
        </Card>
      )}
      <Button
        title={
          questions.isPending
            ? d.candidateDetail.generating
            : questions.data
              ? d.candidateDetail.regenerate
              : d.candidateDetail.generate
        }
        loading={questions.isPending}
        onPress={() => questions.mutate({ candidateId, vacancyId, locale })}
      />
    </View>
  );
}

/**
 * A grounded question about this vacancy's applicants.
 *
 * The answer cites the passage it came from — that is the product's rule, not
 * a nicety: an ungrounded paragraph about a real person's suitability is
 * exactly the thing this product exists not to produce.
 */
function AskSection({ vacancyId, locale }: { vacancyId: string; locale: string }) {
  const { d } = useI18n();
  const [question, setQuestion] = useState("");
  const ask = useAiAnswer();

  return (
    <View className="gap-3">
      <Card className="gap-2">
        <TextInput
          value={question}
          onChangeText={setQuestion}
          multiline
          placeholder={d.candidateDetail.questionPlaceholder}
          accessibilityLabel={d.candidateDetail.questionPlaceholder}
          placeholderTextColor="#8393ac"
          className="min-h-[80px] rounded-control border border-line bg-surface-muted px-3 py-2 text-[14px] text-ink"
        />
        <Meta>{d.candidateDetail.askHint}</Meta>
        <Button
          title={ask.isPending ? d.candidateDetail.generating : d.hrSearch.run}
          loading={ask.isPending}
          disabled={question.trim().length === 0}
          onPress={() =>
            ask.mutate({ question: question.trim(), vacancyId, locale })
          }
        />
      </Card>

      {ask.data ? (
        <AiCard>
          <Body>{ask.data.answer}</Body>
        </AiCard>
      ) : null}
    </View>
  );
}
