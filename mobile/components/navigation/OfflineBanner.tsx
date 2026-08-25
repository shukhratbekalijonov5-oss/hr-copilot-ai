import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useI18n } from "@/lib/i18n/index";

/**
 * A banner while the device has no usable connection.
 *
 * ## Reachability, not just "has an interface"
 *
 * `isInternetReachable` is checked alongside `isConnected` because the common
 * mobile failure is a captive portal or a hotel wifi that answers DHCP and
 * nothing else: connected by every OS measure, and useless. Showing the
 * banner only on airplane mode would leave exactly the case people complain
 * about uncovered.
 *
 * ## It explains, it does not block
 *
 * Nothing here disables a control. Cached screens still render, and a request
 * that fails still surfaces its own error — this only answers "is it me or
 * the app" before somebody starts retrying.
 */
export function OfflineBanner() {
  const { d } = useI18n();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    /*
     * `isInternetReachable` is null while the probe is still running. Null is
     * not "offline" — treating it as such would flash the banner on every
     * cold start before the first probe answers.
     */
    return NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
  }, []);

  if (!offline) return null;

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={d.realtime.offline}
      className="border-b border-warning/25 bg-warning-soft px-4 py-2"
    >
      <Text className="text-[12.5px] font-medium text-warning">
        {d.realtime.offline}
      </Text>
      <Text className="text-[11.5px] text-ink-muted">{d.common.offline}</Text>
    </View>
  );
}
