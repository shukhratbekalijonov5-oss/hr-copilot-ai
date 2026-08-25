import { ActivityIndicator, View } from "react-native";

/**
 * The spinner under an infinite list while the next page loads.
 *
 * It reserves no height when idle: a permanent footer would leave a gap under
 * every short list, and a list that ends should end. `accessibilityElements
 * Hidden` keeps a decorative spinner out of the screen reader's path — the
 * arrival of new rows is what a reader needs announced, not the wait.
 */
export function ListFooter({ loading }: { loading: boolean }) {
  if (!loading) return null;

  return (
    <View
      className="items-center py-4"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}
