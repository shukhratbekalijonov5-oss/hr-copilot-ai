import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  type BadgeTone,
} from "@/components/ui/index";
import { CheckIcon } from "@/components/navigation/icons";
import { VacancyPicker } from "@/components/recruiter/VacancyPicker";
import { format, useI18n } from "@/lib/i18n/index";
import {
  MAX_COMPARE_CANDIDATES,
  useComparison,
  useVacancyCandidates,
} from "@/features/recruiter/candidates";
import { cn } from "@/lib/utils";
import type { EvidenceStatus } from "@/types";

/**
 * Compare applicants within ONE vacancy.
 *
 * ## Stacked by requirement, not a table
 *
 * A four-column table on a phone is either unreadably narrow or a horizontal
 * scroll that hides the row label the moment you move. So each requirement
 * is a card and each candidate is a row inside it: the question stays on
 * screen while the answers are read, which is the comparison a recruiter is
 * actually making.
 *
 * ## The states are categorical because the judgement is
 *
 * STRONG, PARTIAL, GAP and NOT_RUN come from stored evidence. There is no
 * percentage, no total and no winner — turning "the documents partially
 * support this" into 62% would manufacture a precision the evidence does not
 * carry, and a recruiter would reasonably act on the number.
 *
 * ## Scope cannot cross a vacancy
 *
 * Candidates are chosen from the applicants to the selected vacancy, and the
 * comparison is built from evidence maps for that same pair. There is no
 * path here that mixes two vacancies.
 */
export default function CompareScreen() {
  const { d } = useI18n();
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const applicants = useVacancyCandidates(vacancyId);
  const comparison = useComparison(running ? vacancyId : null, selected);

  function toggle(id: string) {
    void Haptics.selectionAsync();
    setRunning(false);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= MAX_COMPARE_CANDIDATES
          ? current
          : [...current, id],
    );
  }

  const rows = applicants.data?.data ?? [];

  return (
    <ScrollView
      contentContainerClassName="pb-10"
      showsVerticalScrollIndicator={false}
    >
      <View className="border-b border-line bg-surface">
        <Meta className="px-4 pt-3">{d.compare.step1}</Meta>
        <VacancyPicker
          value={vacancyId}
          onChange={(next) => {
            // Changing vacancy invalidates the selection: those candidates
            // are applicants to a different role.
            setVacancyId(next);
            setSelected([]);
            setRunning(false);
          }}
        />
      </View>

      {!vacancyId ? (
        <View className="px-4 pt-4">
          <EmptyState title={d.compare.selectVacancy} />
        </View>
      ) : (
        <View className="gap-3 px-4 pt-4">
          <View className="gap-1">
            <SectionTitle>{d.compare.step2}</SectionTitle>
            <Meta>
              {format(d.compare.selectCandidates, {
                count: MAX_COMPARE_CANDIDATES,
              })}
            </Meta>
          </View>

          {applicants.isLoading ? (
            <CardSkeleton rows={3} />
          ) : rows.length === 0 ? (
            <EmptyState title={d.compare.noCandidates} />
          ) : (
            rows.map((candidate) => {
              const picked = selected.includes(candidate.id);
              const full =
                !picked && selected.length >= MAX_COMPARE_CANDIDATES;

              return (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: picked, disabled: full }}
                  accessibilityLabel={candidate.fullName}
                  disabled={full}
                  onPress={() => toggle(candidate.id)}
                  className={cn(
                    "min-h-[56px] flex-row items-center justify-between gap-3 rounded-card border p-4",
                    picked ? "border-brand bg-brand-soft" : "border-line bg-surface",
                    full && "opacity-50",
                  )}
                >
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14.5px] font-semibold text-ink">
                      {candidate.fullName}
                    </Text>
                    {candidate.currentTitle ? (
                      <Text className="mt-0.5 text-[12.5px] text-ink-muted">
                        {candidate.currentTitle}
                      </Text>
                    ) : null}
                  </View>
                  {picked ? <CheckIcon size={18} color="#2d5be8" /> : null}
                </Pressable>
              );
            })
          )}

          {selected.length > 0 ? (
            <Button
              title={`${d.compare.run} · ${format(d.compare.selected, {
                count: selected.length,
              })}`}
              onPress={() => setRunning(true)}
            />
          ) : null}
        </View>
      )}

      {running ? (
        <View className="gap-3 px-4 pt-5">
          {comparison.isLoading ? (
            <CardSkeleton rows={4} />
          ) : comparison.isError ? (
            <ErrorState
              title={d.common.somethingWentWrong}
              retryLabel={d.common.retry}
              onRetry={() => void comparison.refetch()}
            />
          ) : comparison.data ? (
            <ComparisonBody data={comparison.data} />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const STATUS_TONE: Record<EvidenceStatus, BadgeTone> = {
  STRONG: "positive",
  PARTIAL: "warning",
  GAP: "critical",
  NOT_RUN: "neutral",
};

function ComparisonBody({
  data,
}: {
  data: NonNullable<ReturnType<typeof useComparison>["data"]>;
}) {
  const { d } = useI18n();

  const label = (status: EvidenceStatus) =>
    status === "STRONG"
      ? d.compare.statusStrong
      : status === "PARTIAL"
        ? d.compare.statusPartial
        : status === "GAP"
          ? d.compare.statusGap
          : d.compare.statusNotRun;

  const nameOf = (candidateId: string) =>
    data.candidates.find((candidate) => candidate.id === candidateId)?.fullName ??
    candidateId;

  if (data.rows.length === 0) {
    return <EmptyState title={d.compare.noRequirements} />;
  }

  return (
    <View className="gap-3">
      <Card className="gap-1">
        <SectionTitle>{data.vacancyTitle}</SectionTitle>
        <Meta>{d.compare.evidenceNote}</Meta>
      </Card>

      {/* Named plainly: these candidates have no map yet, so their cells
          below say "not checked" rather than implying an absence of
          evidence nobody has looked for. */}
      {data.unmappedCandidateIds.length > 0 ? (
        <Card className="gap-1">
          <Body className="text-ink">{d.compare.statusNotRun}</Body>
          <Meta>{d.compare.notRunHint}</Meta>
          <Meta className="mt-1">
            {data.unmappedCandidateIds.map(nameOf).join(", ")}
          </Meta>
        </Card>
      ) : null}

      {data.rows.map((row) => (
        <Card key={row.requirementId} className="gap-2.5">
          <View className="gap-1">
            <Body className="text-ink">{row.requirementText}</Body>
            <Meta>{row.required ? d.compare.required : d.compare.optional}</Meta>
          </View>

          <View className="gap-2 border-t border-line pt-2.5">
            {row.cells.map((cell) => (
              <View key={cell.candidateId} className="gap-1">
                <View className="flex-row items-center justify-between gap-3">
                  <Body className="flex-1 text-ink">{nameOf(cell.candidateId)}</Body>
                  <Badge
                    label={label(cell.status)}
                    tone={STATUS_TONE[cell.status]}
                  />
                </View>
                {cell.citation ? (
                  <View className="rounded-control border-l-2 border-line-strong bg-surface-muted p-2.5">
                    <Meta>{cell.citation.snippet}</Meta>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}
