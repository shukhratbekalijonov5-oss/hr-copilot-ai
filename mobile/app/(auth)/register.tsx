import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Body, Button, Title } from "@/components/ui/index";
import { AmbientGlow } from "@/components/navigation/GridBackground";
import { ApiError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth/context";
import { registerCandidate, registerOrganization } from "@/lib/auth/session";
import { useI18n } from "@/lib/i18n/index";
import { registerSchemaFor, type RegisterValues } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";
import type { AccountType } from "@/types";

/**
 * Registration, for both kinds of account.
 *
 * ## Two endpoints, because they create two different things
 *
 * A candidate account and an organization account are separate and exclusive
 * in this product's identity model — the backend has `register/candidate` and
 * `register/organization` precisely so neither can be turned into the other.
 * One form with a toggle is a UI convenience over that split, never a merge
 * of it: the organization branch sends an extra field and calls a different
 * route.
 *
 * ## The server decides what was created
 *
 * Both paths finish by reading `/auth/me`, and the router sends the reader
 * wherever that answer says. Nothing here assumes the account it just asked
 * for is the account it got.
 */
export default function RegisterScreen() {
  const { d } = useI18n();
  const { refresh } = useAuth();
  const insets = useSafeAreaInsets();

  const [accountType, setAccountType] = useState<AccountType>("CANDIDATE");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * One resolver for both shapes. The organization field is validated only
   * when that door is selected, so a candidate is never blocked by a field
   * their form does not show.
   */
  const { control, handleSubmit, formState } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchemaFor(accountType)),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      organizationName: "",
    },
    mode: "onChange",
  });

  async function onSubmit(values: RegisterValues) {
    if (submitting) return;
    setSubmitting(true);
    setFailure(null);

    try {
      if (accountType === "ORGANIZATION") {
        await registerOrganization({
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          organizationName: values.organizationName.trim(),
        });
      } else {
        await registerCandidate({
          email: values.email,
          password: values.password,
          fullName: values.fullName,
        });
      }
      // The router reads `/auth/me` and routes on the server's answer.
      await refresh();
    } catch (error) {
      setFailure(messageFor(error, d));
    } finally {
      setSubmitting(false);
    }
  }

  const doors: { id: AccountType; label: string }[] = [
    { id: "CANDIDATE", label: d.auth.candidateTab },
    { id: "ORGANIZATION", label: d.auth.recruiterTab },
  ];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerClassName="px-5 gap-5"
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="overflow-hidden rounded-card p-1">
          <AmbientGlow />
          <Title>{d.register.title}</Title>
          <Body className="mt-1">{d.auth.welcomeHint}</Body>
        </View>

        <View
          accessibilityRole="tablist"
          className="flex-row gap-2 rounded-control border border-line bg-surface p-1"
        >
          {doors.map((door) => (
            <Pressable
              key={door.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: accountType === door.id }}
              accessibilityLabel={door.label}
              onPress={() => setAccountType(door.id)}
              className={cn(
                "min-h-[44px] flex-1 items-center justify-center rounded-md",
                accountType === door.id ? "bg-brand-soft" : "bg-transparent",
              )}
            >
              <Text
                className={cn(
                  "text-[13.5px]",
                  accountType === door.id
                    ? "font-semibold text-brand-ink"
                    : "text-ink-muted",
                )}
              >
                {door.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-3">
          <Field control={control} name="fullName" label={d.register.fullName} />
          {accountType === "ORGANIZATION" ? (
            <Field
              control={control}
              name="organizationName"
              label={d.register.organizationName}
            />
          ) : null}
          <Field
            control={control}
            name="email"
            label={d.auth.email}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Field
            control={control}
            name="password"
            label={d.auth.password}
            secureTextEntry
            textContentType="newPassword"
            hint={d.register.passwordHint}
          />
        </View>

        {failure ? (
          <Text
            accessibilityRole="alert"
            className="rounded-card bg-critical-soft px-3.5 py-3 text-[13px] text-critical"
          >
            {failure}
          </Text>
        ) : null}

        <Button
          title={submitting ? d.register.creating : d.register.createAccount}
          loading={submitting}
          disabled={!formState.isValid}
          onPress={handleSubmit(onSubmit)}
        />

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={d.auth.signIn}
          onPress={() => router.replace("/(auth)/sign-in" as never)}
          className="min-h-[44px] items-center justify-center"
        >
          <Text className="text-[13.5px] text-ink-muted">
            {d.register.haveAccount}{" "}
            <Text className="font-semibold text-brand-ink">{d.auth.signIn}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The server's refusal, localized where we recognise the code. */
function messageFor(error: unknown, d: ReturnType<typeof useI18n>["d"]): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return d.register.emailTaken;
    if (error.kind === "validation") return d.register.weakPassword;
    if (error.kind === "network" || error.kind === "timeout") return d.common.offline;
  }
  return d.common.somethingWentWrong;
}

function Field({
  control,
  name,
  label,
  hint,
  ...input
}: {
  control: ReturnType<typeof useForm<RegisterValues>>["control"];
  name: keyof RegisterValues;
  label: string;
  hint?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="gap-1.5">
          <Text className="text-[13px] font-medium text-ink">{label}</Text>
          <TextInput
            accessibilityLabel={label}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            placeholderTextColor="#8393ac"
            className={cn(
              "min-h-[46px] rounded-control border bg-surface px-3 text-[15px] text-ink",
              fieldState.error ? "border-critical" : "border-line",
            )}
            {...input}
          />
          {hint ? (
            <Text className="text-[11.5px] text-ink-subtle">{hint}</Text>
          ) : null}
        </View>
      )}
    />
  );
}
