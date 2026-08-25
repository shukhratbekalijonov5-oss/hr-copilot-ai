import { useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
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
  Title,
} from "@/components/ui/index";
import { BriefcaseIcon } from "@/components/navigation/icons";
import { format, useI18n } from "@/lib/i18n/index";
import {
  useCloseVacancy,
  useCreateVacancy,
  useDeleteVacancy,
  useUpdateVacancy,
  useVacancies,
} from "@/features/recruiter/queries";
import { ApiError } from "@/lib/api/errors";
import { infiniteListProps } from "@/lib/query/pagination";
import { ListFooter } from "@/components/ui/ListFooter";
import type { Vacancy } from "@/types";

/**
 * The recruiter's vacancies, and the writes they may perform on them.
 *
 * ## Ownership stays the backend's rule
 *
 * A recruiter acts only on vacancies they created; the server answers
 * `VACANCY_NOT_OWNED` otherwise. This screen sends no organization id, filters
 * nothing by ownership and hides no control on a local guess — a button
 * hidden from somebody the server would have allowed is as wrong as one
 * shown to somebody it refuses, and only the second is visible in testing.
 *
 * ## No manual candidate upload
 *
 * There is deliberately no "add a candidate" action anywhere here. Applying
 * is the only way a person enters a vacancy in this product, and a recruiter
 * upload path would create rows nobody consented to.
 */
export default function VacanciesScreen() {
  const { d } = useI18n();
  const vacancies = useVacancies();
  const [editing, setEditing] = useState<Vacancy | "new" | null>(null);

  const rows = vacancies.rows;

  return (
    <View className="flex-1">
      {vacancies.isLoading ? (
        <View className="px-4 pt-4">
          <CardSkeleton rows={4} />
        </View>
      ) : vacancies.isError ? (
        <View className="px-4 pt-4">
          <ErrorState
            title={d.common.somethingWentWrong}
            retryLabel={d.common.retry}
            onRetry={() => void vacancies.refetch()}
          />
        </View>
      ) : rows.length === 0 ? (
        <View className="px-4 pt-4">
          <EmptyState
            icon={<BriefcaseIcon size={20} color="#8393ac" />}
            title={d.vacancies.empty}
            description={d.vacancies.emptyHint}
            action={
              <Button
                title={d.vacancies.emptyCta}
                onPress={() => setEditing("new")}
              />
            }
          />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-24 pt-4 gap-3"
          showsVerticalScrollIndicator={false}
          {...infiniteListProps(vacancies)}
          ListFooterComponent={<ListFooter loading={vacancies.isFetchingNextPage} />}
          refreshControl={
            <RefreshControl
              refreshing={vacancies.isRefetching && !vacancies.isFetchingNextPage}
              onRefresh={() => void vacancies.refetch()}
            />
          }
          renderItem={({ item }) => (
            <VacancyRow vacancy={item} onEdit={() => setEditing(item)} />
          )}
        />
      )}

      {rows.length > 0 ? (
        <View className="absolute inset-x-0 bottom-0 border-t border-line bg-surface px-4 pb-6 pt-3">
          <Button title={d.vacancyForm.create} onPress={() => setEditing("new")} />
        </View>
      ) : null}

      <VacancyForm
        target={editing}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

function VacancyRow({
  vacancy,
  onEdit,
}: {
  vacancy: Vacancy;
  onEdit: () => void;
}) {
  const { d } = useI18n();
  const remove = useDeleteVacancy();
  const close = useCloseVacancy();

  function confirmDelete() {
    Alert.alert(d.vacancyForm.deleteTitle, d.vacancyForm.deleteWarning, [
      { text: d.common.cancel, style: "cancel" },
      {
        text: d.vacancyForm.delete,
        style: "destructive",
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          remove.mutate(vacancy.id, {
            onError: (error) => {
              // The server's ownership rule, surfaced as its own message.
              const message =
                error instanceof ApiError && error.kind === "forbidden"
                  ? d.vacancyForm.notOwned
                  : d.common.somethingWentWrong;
              Alert.alert(message);
            },
          });
        },
      },
    ]);
  }

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <SectionTitle>{vacancy.title}</SectionTitle>
          {vacancy.location ? <Meta className="mt-0.5">{vacancy.location}</Meta> : null}
        </View>
        <Badge
          label={vacancy.status}
          tone={vacancy.status === "OPEN" ? "positive" : "neutral"}
        />
      </View>

      {typeof vacancy.applicantCount === "number" ? (
        <Body className="text-[12.5px]">
          {format(d.vacancies.applicants, { count: vacancy.applicantCount })}
        </Body>
      ) : null}

      <View className="flex-row flex-wrap gap-2 border-t border-line pt-2.5">
        <Button title={d.vacancyForm.edit} variant="secondary" onPress={onEdit} />
        {vacancy.status === "OPEN" ? (
          <Button
            title={d.vacancyForm.close}
            variant="ghost"
            disabled={close.isPending}
            onPress={() => close.mutate(vacancy.id)}
          />
        ) : null}
        <Button
          title={d.vacancyForm.delete}
          variant="ghost"
          disabled={remove.isPending}
          onPress={confirmDelete}
        />
      </View>
    </Card>
  );
}

/**
 * Create or edit, in a sheet-style modal.
 *
 * A full screen for four fields would need its own route and a back stack
 * entry; a modal keeps the list underneath, which is the context somebody
 * editing a title actually wants.
 */
function VacancyForm({
  target,
  onClose,
}: {
  target: Vacancy | "new" | null;
  onClose: () => void;
}) {
  const { d } = useI18n();
  const create = useCreateVacancy();
  const update = useUpdateVacancy();

  const existing = target && target !== "new" ? target : null;
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [seeded, setSeeded] = useState<string | null>(null);

  /*
   * Seeding happens during render rather than in an effect, keyed on which
   * vacancy is open. An effect would paint one frame of the previous
   * vacancy's text before correcting itself.
   */
  const key = existing?.id ?? (target === "new" ? "new" : null);
  if (key !== null && seeded !== key) {
    setSeeded(key);
    setTitle(existing?.title ?? "");
    setLocation(existing?.location ?? "");
    setDescription("");
  }

  if (!target) return null;

  const pending = create.isPending || update.isPending;

  async function submit() {
    const payload = {
      title: title.trim(),
      location: location.trim() || undefined,
      description: description.trim() || undefined,
    };
    if (payload.title.length === 0) return;

    try {
      if (existing) {
        await update.mutateAsync({ id: existing.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (error) {
      Alert.alert(
        error instanceof ApiError && error.kind === "forbidden"
          ? d.vacancyForm.notOwned
          : d.common.somethingWentWrong,
      );
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        className="flex-1 bg-canvas"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="px-4 pb-10 pt-6 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <Title>{existing ? d.vacancyForm.edit : d.vacancyForm.create}</Title>

          <Field
            label={d.vacancyForm.titleField}
            value={title}
            onChangeText={setTitle}
          />
          <Field
            label={d.vacancyForm.locationField}
            value={location}
            onChangeText={setLocation}
          />
          <Field
            label={d.vacancyForm.descriptionField}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Button
            title={existing ? d.vacancyForm.saveChanges : d.vacancyForm.create_}
            loading={pending}
            disabled={title.trim().length === 0}
            onPress={() => void submit()}
          />
          <Button title={d.common.cancel} variant="ghost" onPress={onClose} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View className="gap-1.5">
      <Meta>{label}</Meta>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8393ac"
        className="min-h-[46px] rounded-control border border-line bg-surface px-3 py-2 text-[15px] text-ink"
        {...props}
      />
    </View>
  );
}
