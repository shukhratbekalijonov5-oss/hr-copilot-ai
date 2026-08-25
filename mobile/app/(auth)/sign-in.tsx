import { zodResolver } from "@hookform/resolvers/zod";
import { router } from "expo-router";
import { useEffect, useState } from "react";
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
import { AmbientGlow, GridBackground } from "@/components/navigation/GridBackground";
import { SparkIcon } from "@/components/navigation/icons";
import { ApiError, API_CODES, numericDetail } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth/context";
import { login } from "@/lib/auth/session";
import { format, useI18n } from "@/lib/i18n/index";
import { signInSchema, type SignInValues } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";
import type { AccountType } from "@/types";

/**
 * Sign in, for both doors.
 *
 * ## The lockout countdown is DISPLAY only
 *
 * The backend answers 429 `LOGIN_TEMPORARILY_LOCKED` with `retryAfterSeconds`.
 * The timer here counts that number down so somebody can see when to come
 * back — it does not decide anything. When it reaches zero the button
 * re-enables and the next attempt goes to the server, which locks again if it
 * disagrees. Implementing the lock locally would be both wrong (a reinstall
 * would clear it) and pointless (the server refuses regardless).
 *
 * ## The tab declares which door was used
 *
 * `accountType` is sent so the backend can refuse credentials that belong to
 * the other kind of account — the existing contract. The response still
 * decides the role; this only says which form was filled in.
 */
export default function SignInScreen() {
  const { d } = useI18n();
  const { refresh } = useAuth();
  const insets = useSafeAreaInsets();

  const [accountType, setAccountType] = useState<AccountType>("CANDIDATE");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);

  const { control, handleSubmit, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  // One interval while locked; it clears itself the moment it hits zero.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const id = setInterval(() => setLockedFor((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [lockedFor]);

  async function onSubmit(values: SignInValues) {
    if (submitting || lockedFor > 0) return;
    setSubmitting(true);
    setFailure(null);

    try {
      await login({ ...values, accountType });
      await refresh();
      router.replace("/");
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === API_CODES.LOGIN_TEMPORARILY_LOCKED) {
          setLockedFor(numericDetail(error, "retryAfterSeconds") ?? 60);
          setFailure(null);
        } else if (error.kind === "network" || error.kind === "timeout") {
          setFailure(d.common.offline);
        } else if (error.kind === "unauthorized" || error.kind === "validation") {
          // Never the server's prose: it is written for an operator and is
          // English-only, and this screen has four languages.
          setFailure(d.auth.invalidCredentials);
        } else {
          setFailure(d.common.somethingWentWrong);
        }
      } else {
        setFailure(d.common.somethingWentWrong);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const locked = lockedFor > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-canvas"
    >
      <GridBackground />
      <AmbientGlow />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 48, paddingBottom: 40 }}
        contentContainerClassName="px-6 gap-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-3">
          <View className="size-11 items-center justify-center rounded-control bg-brand">
            <SparkIcon size={22} color="#ffffff" />
          </View>
          <Title>{d.auth.welcome}</Title>
          <Body>{d.auth.welcomeHint}</Body>
        </View>

        {/* Which door. Segmented, so both are visible rather than hidden in a picker. */}
        <View className="flex-row rounded-control border border-line bg-surface-muted p-1">
          {(["CANDIDATE", "ORGANIZATION"] as const).map((type) => (
            <Pressable
              key={type}
              accessibilityRole="tab"
              accessibilityState={{ selected: accountType === type }}
              onPress={() => setAccountType(type)}
              className={cn(
                "min-h-[40px] flex-1 items-center justify-center rounded-[8px]",
                accountType === type && "bg-surface",
              )}
            >
              <Text
                className={cn(
                  "text-[13.5px]",
                  accountType === type ? "font-semibold text-ink" : "text-ink-muted",
                )}
              >
                {type === "CANDIDATE" ? d.auth.candidateTab : d.auth.recruiterTab}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-3">
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
            textContentType="password"
          />
        </View>

        {locked ? (
          <View
            accessibilityRole="alert"
            className="gap-1 rounded-card border border-warning/25 bg-warning-soft p-3.5"
          >
            <Text className="text-[13.5px] font-semibold text-warning">
              {d.auth.lockedTitle}
            </Text>
            <Text className="text-[13px] text-ink-muted">
              {format(d.auth.lockedRetry, { time: formatCountdown(lockedFor) })}
            </Text>
          </View>
        ) : null}

        {failure ? (
          <Text
            accessibilityRole="alert"
            className="rounded-card bg-critical-soft px-3.5 py-3 text-[13px] text-critical"
          >
            {failure}
          </Text>
        ) : null}

        <Button
          title={submitting ? d.auth.signingIn : d.auth.signIn}
          loading={submitting}
          disabled={locked || !formState.isValid}
          onPress={handleSubmit(onSubmit)}
        />

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={d.register.createAccount}
          onPress={() => router.replace("/(auth)/register" as never)}
          className="min-h-[44px] items-center justify-center"
        >
          <Text className="text-[13.5px] text-ink-muted">
            {d.register.noAccount}{" "}
            <Text className="font-semibold text-brand-ink">
              {d.register.createAccount}
            </Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** `mm:ss`, so a two-minute lock does not read as "134 seconds". */
function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function Field({
  control,
  name,
  label,
  ...input
}: {
  control: ReturnType<typeof useForm<SignInValues>>["control"];
  name: keyof SignInValues;
  label: string;
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
            placeholderTextColor="#968e9c"
            className={cn(
              "min-h-[46px] rounded-control border bg-surface px-3 text-[15px] text-ink",
              fieldState.error ? "border-critical" : "border-line",
            )}
            {...input}
          />
        </View>
      )}
    />
  );
}
