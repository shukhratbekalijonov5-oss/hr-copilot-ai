import { router, usePathname } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BriefcaseIcon,
  HomeIcon,
  MessageIcon,
  MoreIcon,
  SparkIcon,
  UsersIcon,
  type IconProps,
} from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { activeTabId, type TabDefinition } from "@/lib/navigation/tabs";
import { useUiStore } from "@/stores/ui";
import { useThemeStore } from "@/stores/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<TabDefinition["icon"], (p: IconProps) => React.JSX.Element> = {
  home: HomeIcon,
  briefcase: BriefcaseIcon,
  spark: SparkIcon,
  message: MessageIcon,
  more: MoreIcon,
  users: UsersIcon,
};

/**
 * The five-item bottom bar.
 *
 * ## It is not `expo-router`'s Tabs
 *
 * Two of the five entries open a sheet rather than navigating, and a Tabs
 * navigator insists every tab is a route — which would mean inventing empty
 * Career and Hiring screens whose only job is to open something else and
 * bounce back. A plain bar over a Stack keeps the route tree honest.
 *
 * ## Colour is not the only active signal
 *
 * The active tab gets a filled pill behind its icon as well as accent
 * colour, and `accessibilityState.selected` announces it — so the position
 * is legible without relying on hue.
 */
export function TabBar({ tabs }: { tabs: TabDefinition[] }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { d } = useI18n();
  const setOpenSheet = useUiStore((state) => state.setOpenSheet);
  const resolved = useThemeStore((state) => state.resolved);

  const active = activeTabId(tabs, pathname);
  const activeColor = resolved === "dark" ? "#b3adff" : "#4a3ac9";
  const idleColor = resolved === "dark" ? "#718096" : "#968e9c";

  return (
    <View
      className="flex-row border-t border-line bg-surface"
      style={{ paddingBottom: insets.bottom || 8 }}
    >
      {tabs.map((tab) => {
        const Icon = ICONS[tab.icon];
        const selected = active === tab.id;
        const label = tab.labelOf(d);

        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={label}
            onPress={() => {
              if (tab.kind === "sheet" && tab.sheet) setOpenSheet(tab.sheet);
              else if (tab.href) router.navigate(tab.href as never);
            }}
            className="min-h-[52px] flex-1 items-center justify-center gap-1 pt-2"
          >
            <View
              className={cn(
                "h-7 w-12 items-center justify-center rounded-full",
                selected && "bg-brand-soft",
              )}
            >
              <Icon size={20} color={selected ? activeColor : idleColor} />
            </View>
            <Text
              numberOfLines={1}
              className={cn(
                "text-[10.5px]",
                selected ? "font-semibold text-brand-ink" : "text-ink-subtle",
              )}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
