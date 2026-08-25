import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  Body,
  Button,
  Card,
  CardSkeleton,
  ErrorState,
  Meta,
  SectionTitle,
} from "@/components/ui/index";
import { useI18n } from "@/lib/i18n/index";
import {
  useClearJobPreferences,
  useJobPreferences,
  useSaveJobPreferences,
} from "@/features/profile/queries";
import type { JobPreferences } from "@/types";

/**
 * What kind of job the candidate WANTS.
 *
 * ## Blank means "no preference", and never "reject everything"
 *
 * That distinction is the whole screen. An empty filter in most products
 * means nothing matches; here it means the reader has not said, so the
 * ranking simply does not use that dimension. The hint says so in words
 * because the input cannot say it by itself.
 *
 * ## These rank, they do not exclude
 *
 * Nothing typed here removes a job from any list — it changes the order jobs
 * appear in. Presenting this as a filter would make a reader think they had
 * narrowed a search they had only re-sorted.
 */
export default function JobPreferencesScreen() {
  const { d } = useI18n();
  const preferences = useJobPreferences();
  const save = useSaveJobPreferences();
  const clear = useClearJobPreferences();

  /*
   * The form is seeded once, when the server's answer first arrives. Keeping
   * it in state rather than reading the query on every render is what lets a
   * background refetch land without overwriting half-typed text.
   */
  const [draft, setDraft] = useState<JobPreferences | null>(null);
  const value = draft ?? preferences.data ?? null;

  if (preferences.isLoading) {
    return (
      <View className="px-4 pt-4">
        <CardSkeleton rows={3} />
      </View>
    );
  }

  if (preferences.isError || !value) {
    return (
      <View className="px-4 pt-4">
        <ErrorState
          title={d.common.somethingWentWrong}
          retryLabel={d.common.retry}
          onRetry={() => void preferences.refetch()}
        />
      </View>
    );
  }

  function patch(next: Partial<JobPreferences>) {
    setDraft({ ...(value as JobPreferences), ...next });
  }

  /** Comma-separated text ↔ list, with blanks dropped rather than stored. */
  const asList = (text: string) =>
    text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerClassName="px-4 pb-10 pt-4 gap-4"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card className="gap-1">
          <SectionTitle>{d.preferences.title}</SectionTitle>
          <Body>{d.preferences.subtitle}</Body>
          <Meta className="mt-1">{d.preferences.notStatedHint}</Meta>
        </Card>

        <Card className="gap-3">
          <Field
            label={d.preferences.desiredTitles}
            hint={d.preferences.desiredTitlesHint}
            value={(value.desiredTitles ?? []).join(", ")}
            onChangeText={(text) => patch({ desiredTitles: asList(text) })}
          />
          <Field
            label={d.preferences.locations}
            hint={d.preferences.desiredTitlesHint}
            value={(value.locations ?? []).join(", ")}
            onChangeText={(text) => patch({ locations: asList(text) })}
          />
          <Field
            label={d.preferences.workModes}
            hint={d.preferences.desiredTitlesHint}
            value={(value.workModes ?? []).join(", ")}
            onChangeText={(text) => patch({ workModes: asList(text) })}
          />
          <Field
            label={d.preferences.employmentTypes}
            hint={d.preferences.desiredTitlesHint}
            value={(value.employmentTypes ?? []).join(", ")}
            onChangeText={(text) => patch({ employmentTypes: asList(text) })}
          />
        </Card>

        <Card className="gap-3">
          <SectionTitle>{d.preferences.salary}</SectionTitle>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Field
                label={d.preferences.minSalary}
                value={value.minSalary == null ? "" : String(value.minSalary)}
                keyboardType="number-pad"
                onChangeText={(text) => patch({ minSalary: toAmount(text) })}
              />
            </View>
            <View className="flex-1">
              <Field
                label={d.preferences.maxSalary}
                value={value.maxSalary == null ? "" : String(value.maxSalary)}
                keyboardType="number-pad"
                onChangeText={(text) => patch({ maxSalary: toAmount(text) })}
              />
            </View>
          </View>
          <Field
            label={d.preferences.currency}
            value={value.salaryCurrency ?? ""}
            autoCapitalize="characters"
            onChangeText={(text) =>
              patch({ salaryCurrency: text.trim() === "" ? null : text.trim() })
            }
          />

          <View className="flex-row items-center justify-between gap-3 pt-1">
            <Body className="flex-1">{d.preferences.openToRelocation}</Body>
            <Switch
              value={value.openToRelocation === true}
              accessibilityLabel={d.preferences.openToRelocation}
              onValueChange={(next) => patch({ openToRelocation: next })}
            />
          </View>
        </Card>

        {save.isSuccess ? (
          <Meta className="text-positive">{d.preferences.saved}</Meta>
        ) : null}
        {clear.isSuccess ? (
          <Meta className="text-positive">{d.preferences.cleared}</Meta>
        ) : null}

        <Button
          title={d.common.save}
          loading={save.isPending}
          onPress={() => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            save.mutate(value);
          }}
        />
        <Button
          title={d.preferences.clear}
          variant="ghost"
          disabled={clear.isPending}
          onPress={() => {
            setDraft(null);
            clear.mutate();
          }}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * An empty box is "not stated" — `null`, not `0`.
 *
 * Sending 0 would be a real statement: a salary floor of zero, which ranks
 * every job as satisfying it. Silence has to stay silence all the way to the
 * request body.
 */
function toAmount(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  if (digits.length === 0) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

function Field({
  label,
  hint,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string; hint?: string }) {
  return (
    <View className="gap-1">
      <Meta>{label}</Meta>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8393ac"
        className="min-h-[44px] rounded-control border border-line bg-surface-muted px-3 text-[14px] text-ink"
        {...props}
      />
      {hint ? <Meta className="text-[11px]">{hint}</Meta> : null}
    </View>
  );
}
