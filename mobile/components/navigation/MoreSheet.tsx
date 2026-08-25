import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { BottomSheet, SheetItem } from "@/components/navigation/BottomSheet";
import {
  BellIcon,
  SearchIcon,
  SparkIcon,
  UserIcon,
} from "@/components/navigation/icons";
import { logout } from "@/lib/auth/session";
import { LOCALE_LABELS, LOCALES, useI18n } from "@/lib/i18n/index";
import { useThemeStore, type ThemeChoice } from "@/stores/theme";
import { cn } from "@/lib/utils";

/**
 * More: the pages that do not earn a tab, plus device preferences.
 *
 * Profile lives here rather than in the bar because Chats is the more
 * frequent destination and the bar holds five. Language and appearance sit
 * here too — both are device preferences, not product surfaces, and neither
 * deserves a screen of its own.
 */
export function MoreSheet({
  visible,
  role,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  role: "candidate" | "recruiter";
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const { d, locale, setLocale } = useI18n();
  const choice = useThemeStore((state) => state.choice);
  const setChoice = useThemeStore((state) => state.setChoice);
  const resolved = useThemeStore((state) => state.resolved);
  const iconColor = resolved === "dark" ? "#a8b4c7" : "#6f6877";

  const themes: { id: ThemeChoice; label: string }[] = [
    { id: "light", label: d.more.themeLight },
    { id: "dark", label: d.more.themeDark },
    { id: "system", label: d.more.themeSystem },
  ];

  return (
    <BottomSheet visible={visible} title={d.sheets.more} onClose={onClose}>
      {role === "candidate" ? (
        <>
          <SheetItem
            icon={<UserIcon size={18} color={iconColor} />}
            label={d.titles.myProfile}
            onPress={() => onNavigate("/profile")}
          />
          <SheetItem
            icon={<SearchIcon size={18} color={iconColor} />}
            label={d.titles.jobPreferences}
            onPress={() => onNavigate("/job-preferences")}
          />
        </>
      ) : null}

      <SheetItem
        icon={<SparkIcon size={18} color={iconColor} />}
        label={d.titles.plans}
        onPress={() => onNavigate("/plans")}
      />
      <SheetItem
        icon={<BellIcon size={18} color={iconColor} />}
        label={d.titles.notifications}
        onPress={() => onNavigate("/notifications")}
      />
      <SheetItem
        icon={<UserIcon size={18} color={iconColor} />}
        label={d.titles.settings}
        onPress={() => onNavigate("/settings")}
      />

      <View className="mt-2 gap-3 border-t border-line px-3 pt-4">
        <Segmented
          label={d.more.theme}
          options={themes.map((theme) => ({ id: theme.id, label: theme.label }))}
          value={choice}
          onChange={(id) => setChoice(id as ThemeChoice)}
        />
        <Segmented
          label={d.more.language}
          options={LOCALES.map((code) => ({ id: code, label: LOCALE_LABELS[code] }))}
          value={locale}
          onChange={(id) => setLocale(id as (typeof LOCALES)[number])}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.auth.signOut}
          onPress={async () => {
            onClose();
            // Local clear happens whatever the network does, so a signed-out
            // device really is signed out.
            await logout();
            router.replace("/");
          }}
          className="min-h-[46px] items-center justify-center rounded-control border border-line active:bg-surface-muted"
        >
          <Text className="text-[14px] font-medium text-critical">
            {d.auth.signOut}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

/** A small segmented control. Selection is announced, not just tinted. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
        {label}
      </Text>
      <View className="flex-row rounded-control border border-line bg-surface-muted p-1">
        {options.map((option) => (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === option.id }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.id)}
            className={cn(
              "min-h-[38px] flex-1 items-center justify-center rounded-[8px]",
              value === option.id && "bg-surface",
            )}
          >
            <Text
              numberOfLines={1}
              className={cn(
                "text-[12.5px]",
                value === option.id ? "font-semibold text-ink" : "text-ink-muted",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
