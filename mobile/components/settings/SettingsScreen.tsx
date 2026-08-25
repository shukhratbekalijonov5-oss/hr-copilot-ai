import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import Constants from "expo-constants";
import { Body, Button, Card, Meta, SectionTitle } from "@/components/ui/index";
import { CheckIcon } from "@/components/navigation/icons";
import { LOCALE_LABELS, LOCALES, useI18n, type Locale } from "@/lib/i18n/index";
import { useThemeStore, type ThemeChoice } from "@/stores/theme";
import { useAuth } from "@/lib/auth/context";
import { logout, logoutEverywhere } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Settings, shared by both roles.
 *
 * ## One screen, because there is nothing role-specific here
 *
 * Appearance, language and session are device and account concerns; neither
 * a candidate nor a recruiter has a setting the other lacks. Two near
 * identical screens would drift the first time either gained a row.
 *
 * ## No notification preferences
 *
 * That system was removed from the product. A toggle here would be a control
 * over nothing — worse than absent, because it would look like it worked.
 */
export function SettingsScreen() {
  const { d, locale, setLocale } = useI18n();
  const { user } = useAuth();
  const choice = useThemeStore((state) => state.choice);
  const setChoice = useThemeStore((state) => state.setChoice);
  const [signingOut, setSigningOut] = useState(false);

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: "light", label: d.more.themeLight },
    { id: "dark", label: d.more.themeDark },
    { id: "system", label: d.more.themeSystem },
  ];

  /*
   * Signing out everywhere ends this device's session too, so it is
   * confirmed. The local clear happens regardless of what the server says —
   * a network failure must not leave somebody signed in on a phone they are
   * actively trying to sign out of.
   */
  function confirmSignOutEverywhere() {
    Alert.alert(d.settings.signOutTitle, d.settings.signOutEverywhereWarning, [
      { text: d.common.cancel, style: "cancel" },
      {
        text: d.settings.signOutEverywhere,
        style: "destructive",
        onPress: () => {
          setSigningOut(true);
          void logoutEverywhere().finally(() => setSigningOut(false));
        },
      },
    ]);
  }

  return (
    <ScrollView
      contentContainerClassName="px-4 pb-10 pt-4 gap-4"
      showsVerticalScrollIndicator={false}
    >
      <Card className="gap-3">
        <SectionTitle>{d.settings.appearance}</SectionTitle>
        <View className="flex-row gap-2">
          {themes.map((theme) => (
            <Option
              key={theme.id}
              label={theme.label}
              selected={choice === theme.id}
              onPress={() => setChoice(theme.id)}
            />
          ))}
        </View>
      </Card>

      <Card className="gap-3">
        <SectionTitle>{d.settings.language}</SectionTitle>
        <View className="gap-1">
          {LOCALES.map((code) => (
            <Row
              key={code}
              label={LOCALE_LABELS[code]}
              selected={locale === code}
              onPress={() => setLocale(code as Locale)}
            />
          ))}
        </View>
      </Card>

      <Card className="gap-2">
        <SectionTitle>{d.settings.account}</SectionTitle>
        {user ? (
          <View className="gap-0.5">
            <Body>{user.fullName}</Body>
            <Meta>{user.email}</Meta>
          </View>
        ) : null}
        <Button
          title={d.auth.signOut}
          variant="secondary"
          className="mt-2"
          disabled={signingOut}
          onPress={() => {
            setSigningOut(true);
            void logout().finally(() => setSigningOut(false));
          }}
        />
        <Button
          title={d.settings.signOutEverywhere}
          variant="ghost"
          disabled={signingOut}
          onPress={confirmSignOutEverywhere}
        />
      </Card>

      <Card className="gap-1">
        <SectionTitle>{d.settings.about}</SectionTitle>
        <Meta>
          {d.settings.version} {Constants.expoConfig?.version ?? "—"}
        </Meta>
      </Card>
    </ScrollView>
  );
}

function Option({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      className={cn(
        "min-h-[44px] flex-1 items-center justify-center rounded-control border px-3",
        selected ? "border-brand bg-brand-soft" : "border-line bg-surface-muted",
      )}
    >
      <Text
        className={cn(
          "text-[13.5px] font-medium",
          selected ? "text-brand-ink" : "text-ink-muted",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-[44px] flex-row items-center justify-between rounded-control px-1"
    >
      <Text className="text-[14px] text-ink">{label}</Text>
      {/* A check, not colour alone — the selected row must be readable to
          somebody who cannot distinguish the accent. */}
      {selected ? <CheckIcon size={18} color="#2d5be8" /> : null}
    </Pressable>
  );
}
