import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellIcon, SparkIcon, UserIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { titleForPath } from "@/lib/navigation/tabs";
import { useThemeStore } from "@/stores/theme";
import { useUnreadCount } from "@/features/notifications/queries";

/**
 * The compact mobile header: brand mark, current page title, bell, avatar.
 *
 * ## The title names the page, not the tab
 *
 * `titleForPath` derives it from the route, so Saved Jobs says "Saved Jobs"
 * rather than the "Career" tab that opened it. A desktop breadcrumb has no
 * room here and answers a question nobody asks on a phone.
 *
 * ## The unread badge is server state
 *
 * It comes from the notifications query, not a store — the count belongs to
 * the backend, and a local copy would drift the moment another device read
 * something.
 */
export function AppHeader({ notificationsHref }: { notificationsHref: string }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { d } = useI18n();
  const resolved = useThemeStore((state) => state.resolved);
  const unread = useUnreadCount();

  const iconColor = resolved === "dark" ? "#a8b4c7" : "#6f6877";
  const count = unread.data ?? 0;

  return (
    <View
      className="border-b border-line bg-surface"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-14 flex-row items-center gap-3 px-4">
        <View className="size-8 items-center justify-center rounded-control bg-brand">
          <SparkIcon size={17} color="#ffffff" />
        </View>

        <Text
          numberOfLines={1}
          className="min-w-0 flex-1 text-[16px] font-semibold tracking-tight text-ink"
        >
          {titleForPath(pathname, d)}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            count > 0
              ? `${d.titles.notifications}, ${count}`
              : d.titles.notifications
          }
          hitSlop={8}
          onPress={() => router.navigate(notificationsHref as never)}
          className="size-10 items-center justify-center rounded-control active:bg-surface-muted"
        >
          <BellIcon size={20} color={iconColor} />
          {count > 0 ? (
            <View className="absolute right-1.5 top-1.5 min-w-[16px] items-center rounded-full bg-critical px-1">
              <Text className="text-[10px] font-semibold leading-4 text-white">
                {count > 99 ? "99+" : count}
              </Text>
            </View>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.titles.myProfile}
          hitSlop={8}
          onPress={() => router.navigate("/(candidate)/profile" as never)}
          className="size-9 items-center justify-center rounded-full border border-line bg-surface-muted"
        >
          <UserIcon size={18} color={iconColor} />
        </Pressable>
      </View>
    </View>
  );
}
