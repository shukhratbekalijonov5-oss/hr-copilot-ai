import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import {
  Badge,
  Body,
  Button,
  Card,
  CardSkeleton,
  Chip,
  EmptyState,
  ErrorState,
  Meta,
  SectionTitle,
  Title,
  type BadgeTone,
} from "@/components/ui/index";
import { Avatar } from "@/components/ui/Avatar";
import { useSessionUser } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/index";
import { useEvidenceState } from "@/features/candidate/queries";
import {
  useCandidateAccount,
  useCandidateDocuments,
  useDeleteDocument,
  useReprocessDocument,
  useDeleteAvatar,
  useUpdateCandidateAccount,
  useUploadAvatar,
  useUploadDocument,
} from "@/features/profile/queries";
import { ApiError } from "@/lib/api/errors";
import type { CandidateDocument, DocumentStatus } from "@/types";

/**
 * The candidate's profile and the documents recruiters actually read.
 *
 * ## Current-only, and deletion means everywhere
 *
 * There is no history here because the product has none: deleting a file
 * withdraws it from every organization that had it in view. The confirmation
 * says that in words before the tap, because "delete" on a phone usually
 * means "remove from my list" and here it does not.
 *
 * ## The limits shown are the server's, reported not re-implemented
 *
 * The three-file cap and the size ceiling are enforced by the backend. This
 * screen surfaces the refusal it sends rather than pre-checking, so there is
 * exactly one place those numbers live and no way for a stale copy on the
 * device to reject a file the server would have taken.
 */
export default function CandidateProfileScreen() {
  const { d } = useI18n();
  const user = useSessionUser();
  const account = useCandidateAccount();
  const evidence = useEvidenceState();
  const documents = useCandidateDocuments();
  const update = useUpdateCandidateAccount();
  const upload = useUploadDocument();
  const uploadAvatar = useUploadAvatar();
  const removeAvatar = useDeleteAvatar();

  const rows = documents.data?.data ?? [];
  // Absent while loading means "not known yet", which must not read as full.
  const atCap = documents.data ? documents.data.remaining <= 0 : false;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    currentTitle: string;
    location: string;
    summary: string;
  } | null>(null);

  async function pickAndUpload() {
    const picked = await DocumentPicker.getDocumentAsync({
      // The formats the pipeline can actually parse. Offering everything
      // would let somebody pick a video and wait for a failure.
      type: ["application/pdf", "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    try {
      await upload.mutateAsync({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(d.profile.uploadFailed, messageFor(error, d));
    }
  }

  /**
   * Picks an image and uploads it.
   *
   * Permission is requested at the moment of use rather than at launch: a
   * photo-library prompt on first open, before the reader has asked for
   * anything, is the prompt people deny.
   */
  async function pickAndUploadAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(d.profile.permissionNeeded, d.profile.permissionHint);
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      // Square, because every surface renders it in a circle.
      aspect: [1, 1],
      quality: 0.85,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    try {
      await uploadAvatar.mutateAsync({
        uri: asset.uri,
        name: asset.fileName ?? "avatar.jpg",
        mimeType: asset.mimeType,
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(d.profile.avatarFailed, messageFor(error, d));
    }
  }

  function startEditing() {
    setDraft({
      currentTitle: account.data?.currentTitle ?? "",
      location: account.data?.location ?? "",
      summary: account.data?.summary ?? "",
    });
    setEditing(true);
  }

  if (account.isLoading) {
    return (
      <View className="px-4 pt-4">
        <CardSkeleton rows={3} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerClassName="px-4 pb-10 pt-4 gap-4"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={account.isRefetching || documents.isRefetching}
            onRefresh={() => {
              void account.refetch();
              void documents.refetch();
            }}
          />
        }
      >
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <Avatar
              name={user.fullName}
              src={account.data?.avatarUrl ?? user.avatarUrl ?? null}
              size="lg"
            />
            <View className="min-w-0 flex-1">
              <Title className="text-[20px]">{user.fullName}</Title>
              <Body>{user.email}</Body>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-1.5">
            <Chip label={d.auth.candidateTab} />
            {/* Only when the server stated one. Silence is not "FREE". */}
            {user.plan ? <Chip label={user.plan} /> : null}
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Button
              title={
                uploadAvatar.isPending
                  ? d.profile.uploading
                  : account.data?.avatarUrl
                    ? d.profile.changePhoto
                    : d.profile.addPhoto
              }
              variant="secondary"
              loading={uploadAvatar.isPending}
              onPress={() => void pickAndUploadAvatar()}
            />
            {account.data?.avatarUrl ? (
              <Button
                title={d.profile.removePhoto}
                variant="ghost"
                disabled={removeAvatar.isPending}
                onPress={() => removeAvatar.mutate()}
              />
            ) : null}
          </View>
        </Card>

        {editing && draft ? (
          <Card className="gap-3">
            <SectionTitle>{d.profile.edit}</SectionTitle>
            <Field
              label={d.profile.currentTitle}
              value={draft.currentTitle}
              onChangeText={(text) => setDraft({ ...draft, currentTitle: text })}
            />
            <Field
              label={d.profile.location}
              value={draft.location}
              onChangeText={(text) => setDraft({ ...draft, location: text })}
            />
            <Field
              label={d.profile.summary}
              value={draft.summary}
              multiline
              onChangeText={(text) => setDraft({ ...draft, summary: text })}
            />
            <View className="flex-row gap-2">
              <Button
                title={d.common.save}
                className="flex-1"
                loading={update.isPending}
                onPress={async () => {
                  await update.mutateAsync({
                    // Empty means "cleared", so it is sent as null rather
                    // than as an empty string the API would store verbatim.
                    currentTitle: draft.currentTitle.trim() || null,
                    location: draft.location.trim() || null,
                    summary: draft.summary.trim() || null,
                  });
                  setEditing(false);
                }}
              />
              <Button
                title={d.common.cancel}
                variant="secondary"
                className="flex-1"
                onPress={() => setEditing(false)}
              />
            </View>
          </Card>
        ) : (
          <Card className="gap-2">
            <SectionTitle>{d.profile.title}</SectionTitle>
            <Detail label={d.profile.currentTitle} value={account.data?.currentTitle} />
            <Detail label={d.profile.location} value={account.data?.location} />
            <Detail
              label={d.profile.experience}
              value={
                account.data?.totalExperienceYears == null
                  ? null
                  : String(account.data.totalExperienceYears)
              }
            />
            {account.data?.summary ? <Body>{account.data.summary}</Body> : null}
            {account.data?.skills && account.data.skills.length > 0 ? (
              <View className="mt-1 flex-row flex-wrap gap-1.5">
                {account.data.skills.map((skill) => (
                  <Chip key={skill} label={skill} />
                ))}
              </View>
            ) : null}
            <Button
              title={d.profile.edit}
              variant="secondary"
              className="mt-2 self-start"
              onPress={startEditing}
            />
          </Card>
        )}

        <View className="gap-2">
          <SectionTitle>{d.profile.documents}</SectionTitle>
          <Meta>{d.profile.documentsHint}</Meta>

          {documents.isLoading ? (
            <CardSkeleton rows={2} />
          ) : documents.isError ? (
            <ErrorState
              title={d.common.somethingWentWrong}
              retryLabel={d.common.retry}
              onRetry={() => void documents.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title={d.profile.noDocuments}
              description={d.profile.noDocumentsHint}
            />
          ) : (
            rows.map((document) => (
              <DocumentRow key={document.id} document={document} />
            ))
          )}

          {/*
            `remaining` is the SERVER's cap state, not `rows.length`. A
            tombstoned file can still occupy a slot it no longer appears in,
            so counting the visible rows would offer an upload the backend
            then refuses.
          */}
          {atCap ? (
            <Meta className="text-warning">{d.profile.limitReached}</Meta>
          ) : null}
          <Button
            title={upload.isPending ? d.profile.uploading : d.profile.upload}
            loading={upload.isPending}
            disabled={atCap}
            onPress={() => void pickAndUpload()}
          />
        </View>

        {evidence.data ? (
          <Meta>
            {d.dashboard.evidence}: {evidence.data.total}
          </Meta>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const STATUS_TONE: Record<DocumentStatus, BadgeTone> = {
  PENDING: "neutral",
  QUEUED: "neutral",
  PROCESSING: "info",
  COMPLETED: "positive",
  FAILED: "critical",
};

function DocumentRow({ document }: { document: CandidateDocument }) {
  const { d } = useI18n();
  const remove = useDeleteDocument();
  const reprocess = useReprocessDocument();

  const statusLabel: Record<DocumentStatus, string> = {
    PENDING: d.profile.statusPending,
    QUEUED: d.profile.statusPending,
    PROCESSING: d.profile.statusProcessing,
    COMPLETED: d.profile.statusCompleted,
    FAILED: d.profile.statusFailed,
  };

  function confirmDelete() {
    Alert.alert(d.profile.deleteTitle, d.profile.deleteWarning, [
      { text: d.common.cancel, style: "cancel" },
      {
        text: d.profile.delete,
        style: "destructive",
        onPress: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          remove.mutate(document.id);
        },
      },
    ]);
  }

  return (
    <Card className="gap-2">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <SectionTitle>{document.originalFileName}</SectionTitle>
          {document.errorMessage ? (
            <Meta className="mt-0.5 text-critical">{document.errorMessage}</Meta>
          ) : null}
        </View>
        <Badge
          label={statusLabel[document.status]}
          tone={STATUS_TONE[document.status]}
        />
      </View>

      <View className="flex-row gap-2">
        {document.status === "FAILED" ? (
          <Button
            title={d.profile.reprocess}
            variant="secondary"
            onPress={() => reprocess.mutate(document.id)}
            disabled={reprocess.isPending}
          />
        ) : null}
        <Button
          title={remove.isPending ? d.profile.deleting : d.profile.delete}
          variant="ghost"
          onPress={confirmDelete}
          disabled={remove.isPending}
        />
      </View>
    </Card>
  );
}

/** The server's refusal, in the reader's language where we recognise it. */
function messageFor(error: unknown, d: ReturnType<typeof useI18n>["d"]): string {
  if (error instanceof ApiError) {
    if (error.code === "PERSONAL_DOCUMENT_LIMIT_REACHED") {
      return d.profile.limitReached;
    }
    if (error.status === 413) return d.profile.tooLarge;
  }
  return d.common.somethingWentWrong;
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  const { d } = useI18n();
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Meta>{label}</Meta>
      <Body className="flex-1 text-right">{value ?? d.preferences.notStated}</Body>
    </View>
  );
}

function Field({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View className="gap-1">
      <Meta>{label}</Meta>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#8393ac"
        className="min-h-[44px] rounded-control border border-line bg-surface-muted px-3 py-2 text-[14px] text-ink"
        {...props}
      />
    </View>
  );
}
