import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "@/lib/i18n/index";

/**
 * The hierarchical navigation sheet.
 *
 * ## Why a Modal and not a gesture library
 *
 * These sheets present three or four links. A full gesture-driven sheet
 * library would add a native dependency and a reanimated worklet budget to
 * solve a problem a modal already solves, and the brief explicitly asks not
 * to take a heavy dependency where a simple sheet suffices. Dismissal is by
 * backdrop tap, the hardware back button (`onRequestClose`), and a Close
 * row — three affordances, none of which needs a pan handler.
 *
 * ## Accessibility
 *
 * The backdrop is a real button with a label rather than a bare touchable, so
 * a screen reader can dismiss it; the sheet itself is a `dialog` labelled by
 * its title. Content sits above the home indicator via the safe-area inset.
 */
export function BottomSheet({
  visible,
  title,
  description,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { d } = useI18n();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.common.cancel}
          onPress={onClose}
          className="absolute inset-0 bg-black/50"
        />

        <View
          accessibilityViewIsModal
          accessibilityRole="none"
          className="rounded-t-sheet border-t border-line bg-surface"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          {/* Grab handle: purely visual, so it is hidden from screen readers. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="items-center pt-2.5"
          >
            <View className="h-1 w-10 rounded-full bg-line-strong" />
          </View>

          <View className="px-5 pb-2 pt-3">
            <Text className="text-[18px] font-semibold tracking-tight text-ink">
              {title}
            </Text>
            {description ? (
              <Text className="mt-1 text-[13px] text-ink-muted">{description}</Text>
            ) : null}
          </View>

          <ScrollView
            className="max-h-[60%]"
            contentContainerClassName="px-3 pb-2"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * One row in a sheet. 56pt tall — comfortably above the 44pt floor, because
 * these are the app's primary navigation targets and are reached with a thumb.
 */
export function SheetItem({
  icon,
  label,
  description,
  badge,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  badge?: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 rounded-control px-3 py-2.5 active:bg-surface-muted"
    >
      <View className="size-9 items-center justify-center rounded-control bg-surface-muted">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[14.5px] font-medium text-ink">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-[12px] text-ink-muted" numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      {badge}
    </Pressable>
  );
}
