import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/index";
import { GridBackground } from "@/components/navigation/GridBackground";

/**
 * The role router.
 *
 * ## The account type comes from the server, always
 *
 * `useAuth` exposes whatever `GET /auth/me` returned. Nothing here reads a
 * stored flag or a token claim, so there is no client-side role to spoof —
 * a tampered device simply gets whichever shell the backend says it is, and
 * every route inside that shell is independently guarded anyway.
 *
 * ## Restoring is its own state
 *
 * While the keychain is read and identity is fetched, this renders a splash.
 * Redirecting to sign-in during that window would sign out every returning
 * user for a frame, which is the single most common bug in mobile auth.
 */
export default function Index() {
  const { restoring, user } = useAuth();
  const { d } = useI18n();

  if (restoring) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-canvas">
        <GridBackground />
        <ActivityIndicator />
        <Text className="text-[13px] text-ink-muted">{d.auth.restoring}</Text>
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/sign-in" />;

  return user.accountType === "ORGANIZATION" ? (
    <Redirect href="/(recruiter)/home" />
  ) : (
    <Redirect href="/(candidate)/home" />
  );
}
